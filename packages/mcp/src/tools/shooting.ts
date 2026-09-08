// ── Shooting: load, shoot, unload, and corrections ──

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import { bestMatch, cleanStockName, displayStock, fuzzyMatch, rankedMatch, strictStockMatch } from "../matching.js";
import type { ActiveRoll } from "../types.js";
import { pickActiveRoll } from "../resolve.js";

// Tool bodies are intentionally not re-indented: they moved verbatim out of the
// old single-file server.ts, so the split stays reviewable line by line.
export function register(server: McpServer) {


server.tool(
  "tomu_load",
  "Load a roll of film into a camera. Fuzzy-matches film stock and camera by name. " +
    "Decrements inventory automatically. If both factory and bulk inventory of the same stock exist, " +
    "factory rolls are used first unless the user specifies otherwise.",
  {
    film: z.string().describe("Film stock name (e.g. 'HP5+', 'Tri-X 400', 'Portra 400')"),
    camera: z.string().describe("Camera name (e.g. 'M6', 'Mamiya 7', 'Leica')"),
    format: z.string().optional().describe("Film format: '35mm' (default), '120', '4x5', '8x10'"),
    form: z.string().optional().describe("Override which form to use: 'factory_roll', 'bulk_roll', or 'sheet'"),
    frameCount: z.number().int().positive().optional().describe("Override default frame count (e.g. 24 for a short 35mm cassette)"),
    ratedIso: z.number().int().positive().optional().describe("ISO to shoot at (defaults to stock's box ISO). Use for expired film or intentional push/pull rating."),
    note: z.string().optional().describe("Optional note to attach to the roll at load time"),
  },
  async ({ film, camera, format, form, frameCount, ratedIso, note }) => {
    const fmt = format || "35mm";

    // Resolve stock
    const { data: stocks } = await api<{ data: Array<{ id: string; manufacturer: string; name: string; iso: number }> }>("/film-stocks");
    const stock = bestMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer]);
    if (!stock) {
      return { content: [{ type: "text" as const, text: `Film stock "${film}" not found. Known stocks: ${stocks.map((s) => displayStock(s.manufacturer, s.name)).join(", ") || "none"}.` }] };
    }

    // Resolve camera
    const { data: cams } = await api<{ data: Array<{ id: string; make: string; model: string; format: string }> }>("/cameras");
    const m = rankedMatch(camera, cams, (c) => [`${c.make} ${c.model}`, c.model, c.make]);
    if (m.kind === "none") {
      return { content: [{ type: "text" as const, text: `Camera "${camera}" not found. Known cameras: ${cams.map((c) => `${c.make} ${c.model}`).join(", ") || "none"}.` }] };
    }
    if (m.kind === "tied") {
      return { content: [{ type: "text" as const, text: `Camera "${camera}" is ambiguous. Tied matches: ${m.items.map((c) => `${c.make} ${c.model}`).join(", ")}.` }] };
    }
    const cam = m.item;

    // Load
    const loadBody: Record<string, unknown> = {
      filmStockId: stock.id,
      format: fmt,
      cameraId: cam.id,
    };
    if (form) loadBody.form = form;
    if (frameCount != null) loadBody.frameCount = frameCount;
    if (ratedIso != null) loadBody.ratedIso = ratedIso;

    const loaded = await api<{ data: { id: string; format: string; form: string; frameCount: number; ratedIso: number } }>("/rolls", {
      method: "POST",
      body: JSON.stringify(loadBody),
    });

    // Optional load-time note
    if (note) {
      await api(`/rolls/${loaded.data.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: note }),
      });
    }

    const isoText =
      loaded.data.ratedIso !== stock.iso
        ? `box ${stock.iso}, rated ${loaded.data.ratedIso}`
        : `ISO ${stock.iso}`;
    return {
      content: [{
        type: "text" as const,
        text: `Loaded **${displayStock(stock.manufacturer, stock.name)}** (${loaded.data.format}, ${loaded.data.form.replace("_", " ")}, ${isoText}) into **${cam.make} ${cam.model}** — ${loaded.data.frameCount} frames.${note ? ` Note saved.` : ""}`,
      }],
    };
  }
);

// ── Tool: tomu_shoot ──────────────────────────────────────────────────


server.tool(
  "tomu_shoot",
  "Log a frame on an active roll. Frame number is auto-incremented if omitted. " +
    "All settings fields are optional — pass what you dictated, dump anything unstructured into `notes`. " +
    "If multiple rolls are loaded in different cameras, specify `camera` to disambiguate.",
  {
    camera: z.string().optional().describe("Camera hint to pick the active roll (e.g. 'M6', 'Mamiya')"),
    frameNumber: z.number().int().positive().optional().describe("Explicit frame number. Omit to auto-assign the next frame."),
    shutterSpeed: z.string().optional().describe("Shutter speed (e.g. '1/250', '2s')"),
    aperture: z.string().optional().describe("Aperture (e.g. 'f/8', '5.6')"),
    compensation: z.string().optional().describe("Exposure compensation (e.g. '+1', '-1/3')"),
    meteringMode: z.string().optional().describe("Metering mode: 'incident', 'spot', 'matrix', 'center_weighted', 'sunny_16', 'guess'"),
    subject: z.string().optional().describe("Short subject description"),
    locationName: z.string().optional().describe("Place name"),
    notes: z.string().optional().describe("Free-form notes. Put anything unstructured here."),
    lens: z.string().optional().describe("Lens hint for fuzzy match"),
  },
  async ({ camera, frameNumber, shutterSpeed, aperture, compensation, meteringMode, subject, locationName, notes, lens }) => {
    const { roll, error } = await pickActiveRoll(camera);
    if (error || !roll) return { content: [{ type: "text" as const, text: error! }] };

    // Optional fuzzy lens resolution
    let lensId: string | undefined;
    if (lens) {
      const { data: lenses } = await api<{ data: Array<{ id: string; make: string; model: string; focalLengthMm: number | null }> }>("/lenses");
      const match = lenses.find((l) => fuzzyMatch(lens, `${l.make} ${l.model}`, l.model, String(l.focalLengthMm ?? "")));
      if (match) lensId = match.id;
    }

    const body: Record<string, unknown> = {};
    if (frameNumber != null) body.frameNumber = frameNumber;
    if (lensId) body.lensId = lensId;
    if (shutterSpeed) body.shutterSpeed = shutterSpeed;
    if (aperture) body.aperture = aperture;
    if (compensation) body.compensation = compensation;
    if (meteringMode) body.meteringMode = meteringMode;
    if (subject) body.subject = subject;
    if (locationName) body.locationName = locationName;
    if (notes) body.notes = notes;

    const frame = await api<{ data: { frameNumber: number; shutterSpeed: string | null; aperture: string | null } }>(`/rolls/${roll.id}/frames`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const f = frame.data;
    const settings = [f.shutterSpeed, f.aperture].filter(Boolean).join(" ");
    return {
      content: [{
        type: "text" as const,
        text: `Frame ${f.frameNumber}/${roll.frameCount} logged on ${displayStock(roll.manufacturer, roll.stockName)} in ${roll.cameraMake} ${roll.cameraModel}${settings ? ` — ${settings}` : ""}${subject ? ` — ${subject}` : ""}.`,
      }],
    };
  }
);

// ── Tool: tomu_unload ─────────────────────────────────────────────────


server.tool(
  "tomu_unload",
  "Unload a roll from a camera. Assigns a display ID (YYYYMMDD.N) based on your local date. " +
    "If you have multiple active rolls, specify `camera`.",
  {
    camera: z.string().optional().describe("Camera hint to pick the roll to unload"),
    note: z.string().optional().describe("Optional note attached to the roll at unload time"),
  },
  async ({ camera, note }) => {
    const { roll, error } = await pickActiveRoll(camera);
    if (error || !roll) return { content: [{ type: "text" as const, text: error! }] };

    // Local date based on MCP host (which is the user's machine)
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const { data } = await api<{ data: { displayId: string; unloadedAt: string } }>(`/rolls/${roll.id}/unload`, {
      method: "POST",
      body: JSON.stringify({ localDate, note }),
    });

    return {
      content: [{
        type: "text" as const,
        text: `Unloaded **${displayStock(roll.manufacturer, roll.stockName)}** from ${roll.cameraMake} ${roll.cameraModel}. ID: **${data.displayId}** (${roll.framesShot} frames logged).${note ? " Note saved." : ""}`,
      }],
    };
  }
);

// ── Field events ──────────────────────────────────────────────────────
//
// The field stream: voice notes (verbatim transcript + parsed fields) and photos.
// This tool path is the Claude-app fallback; the PWA is the primary field surface.
// The photo never passes through Claude.


server.tool(
  "tomu_note",
  "Add a timestamped note to the active roll, or to a specific frame on it. " +
    "Use this for any context that doesn't fit structured frame fields.",
  {
    content: z.string().describe("The note content"),
    frameNumber: z.number().int().positive().optional().describe("If set, attach to this frame instead of the roll itself"),
    camera: z.string().optional().describe("Camera hint if multiple rolls are active"),
  },
  async ({ content, frameNumber, camera }) => {
    const { roll, error } = await pickActiveRoll(camera);
    if (error || !roll) return { content: [{ type: "text" as const, text: error! }] };

    const path = frameNumber
      ? `/rolls/${roll.id}/frames/${frameNumber}/notes`
      : `/rolls/${roll.id}/notes`;
    await api(path, { method: "POST", body: JSON.stringify({ content }) });

    const target = frameNumber
      ? `frame ${frameNumber} of ${displayStock(roll.manufacturer, roll.stockName)}`
      : `${displayStock(roll.manufacturer, roll.stockName)} in ${roll.cameraMake} ${roll.cameraModel}`;
    return { content: [{ type: "text" as const, text: `Note added to ${target}.` }] };
  }
);

// ── Tool: tomu_undo_load ──────────────────────────────────────────────


server.tool(
  "tomu_undo_load",
  "Undo a load — use when a roll was loaded by mistake. Deletes the roll entirely and " +
    "credits inventory back. Distinct from unload: this treats the load as if it never " +
    "happened. Frames and notes on the roll are also deleted. Only works before unload.",
  {
    camera: z.string().optional().describe("Camera hint to pick which active roll to undo"),
  },
  async ({ camera }) => {
    const { roll, error } = await pickActiveRoll(camera);
    if (error || !roll) return { content: [{ type: "text" as const, text: error! }] };

    await api(`/rolls/${roll.id}`, { method: "DELETE" });

    const warn =
      roll.framesShot > 0
        ? ` **Deleted ${roll.framesShot} logged frame(s)** along with the roll.`
        : "";
    return {
      content: [{
        type: "text" as const,
        text: `Undid load of ${displayStock(roll.manufacturer, roll.stockName)} in ${roll.cameraMake} ${roll.cameraModel}. Inventory restored.${warn}`,
      }],
    };
  }
);

// ── Tool: tomu_rolls ──────────────────────────────────────────────────


server.tool(
  "tomu_rolls",
  "List rolls. Defaults to active (loaded or shooting); pass status='all' or any specific RollStatus (shot, developing, developed, scanning, complete, archived). " +
    "Dev Id filters answer history questions like 'what were Dev Ids 0727–0732' (devSeqRange) or 'rolls developed 2026-05-12' (devDate) — using any of them defaults status to 'all'.",
  {
    status: z.string().optional().describe("'active' (default), 'all', or RollStatus: loaded | shooting | shot | developing | developed | scanning | complete | archived"),
    devSeq: z.number().int().optional().describe("Exact Dev Id sequence number (e.g. 721)"),
    devSeqRange: z.string().optional().describe("Inclusive Dev Id seq range, e.g. '717-735' (single number works too)"),
    devDate: z.string().optional().describe("Rolls developed on this local date (YYYY-MM-DD)"),
    devDateFrom: z.string().optional().describe("Developed on or after (YYYY-MM-DD)"),
    devDateTo: z.string().optional().describe("Developed on or before (YYYY-MM-DD)"),
  },
  async ({ status, devSeq, devSeqRange, devDate, devDateFrom, devDateTo }) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (devSeq != null) params.set("dev_seq", String(devSeq));
    if (devSeqRange) params.set("dev_seq_range", devSeqRange);
    if (devDate) {
      params.set("dev_date_from", devDate);
      params.set("dev_date_to", devDate);
    }
    if (devDateFrom) params.set("dev_date_from", devDateFrom);
    if (devDateTo) params.set("dev_date_to", devDateTo);
    const qs = params.toString();
    const hasDevFilter = devSeq != null || !!devSeqRange || !!devDate || !!devDateFrom || !!devDateTo;

    const { data } = await api<{
      data: Array<
        ActiveRoll & {
          displayId: string | null;
          unloadedAt: string | null;
          devId: string | null;
          devDate: string | null;
          devSeq: number | null;
          intendedDeveloper: string | null;
          intendedDilution: string | null;
          intendedDevTimeSeconds: number | null;
        }
      >;
    }>(`/rolls${qs ? `?${qs}` : ""}`);

    const scope = hasDevFilter ? "dev filter" : status || "active";
    if (data.length === 0) {
      return { content: [{ type: "text" as const, text: `No rolls found (${scope}).` }] };
    }

    const lines: string[] = [`## Rolls (${scope}: ${data.length})\n`];
    for (const r of data) {
      // display_id is the shooting handle; dev_id is the lifetime dev handle.
      // Rolls with neither (orphans) fall back to "unassigned".
      const id = r.displayId ?? r.devId ?? "unassigned";
      const cam = r.cameraMake ? `${r.cameraMake} ${r.cameraModel}` : "—";
      const dev = r.devId ? ` — Dev ${r.devId}` : "";
      const intended = r.intendedDeveloper && !r.devId ? ` — plan: ${r.intendedDeveloper}${r.intendedDilution ? ` ${r.intendedDilution}` : ""}` : "";
      lines.push(`- **${id}** — ${displayStock(r.manufacturer, r.stockName)} (${r.format}) in ${cam} [${r.status}] — ${r.framesShot}/${r.frameCount}${dev}${intended}`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_log_shot_roll ──────────────────────────────────────────


server.tool(
  "tomu_log_shot_roll",
  "Retroactively log a roll that's already been shot — for backlog/fridge-pile entry. " +
    "Drops the roll straight into status='shot' with no inventory decrement. " +
    "Use this for canisters/sheets you find lying around, not for the field-shoot flow (which is tomu_load → tomu_shoot → tomu_unload). " +
    "If you don't know the shot date, leave it off — you can patch later.",
  {
    film: z.string().describe("Film stock name (fuzzy: 'hp5', 'fp4', 'no.5', 'tri-x')"),
    format: z.string().optional().describe("Film format: '35mm' (default), '120', '4x5', '8x10'"),
    camera: z.string().optional().describe("Camera name (fuzzy, optional: 'm6', 'mm7', 'intrepid')"),
    ratedIso: z.number().int().positive().optional().describe("Rated ISO (defaults to box ISO of the stock)"),
    shotDate: z.string().optional().describe("Approx YYYY-MM-DD when shot. Used for displayId. Omit if unknown."),
    fieldSeq: z.number().int().min(1).max(99).optional().describe("Sequence number to honor an existing physical label (e.g. 7 → '20250506.07'). Server picks next available if omitted. 409 if collides."),
    intendedDeveloper: z.string().optional().describe("Intended developer when known: 'HC-110', 'Rodinal', '510 Pyro'. Defaults to HC-110 when devShorthand is a letter code."),
    devShorthand: z.string().optional().describe("Pre-stamped dev shorthand from bag/canister label: 'B7.5', '1:50/8mins', 'E10:40'. Parsed into intended dilution + time."),
    note: z.string().optional().describe("Free-text note (e.g. 'mystery roll, brandy trade, possible HP5')"),
    tags: z.array(z.string()).optional().describe("Tags (e.g. ['fridge-backlog', '2025-road-trip'])"),
    form: z.string().optional().describe("Override form: 'factory_roll' (default), 'bulk_roll', 'sheet'"),
    frameCount: z.number().int().positive().optional().describe("Override frame count"),
    manufacturer: z.string().optional().describe("If the stock doesn't exist yet, providing manufacturer + iso (+ optional type) creates it on the fly."),
    iso: z.number().int().positive().optional().describe("Box ISO for stock auto-creation."),
    type: z.string().optional().describe("Film type for auto-creation: 'bw' (default), 'color_negative', 'color_positive'."),
  },
  async ({ film, format, camera, ratedIso, shotDate, fieldSeq, intendedDeveloper, devShorthand, note, tags, form, frameCount, manufacturer, iso, type }) => {
    const fmt = format || "35mm";

    const { data: stocks } = await api<{ data: Array<{ id: string; manufacturer: string; name: string; iso: number; aliases?: string[] }> }>("/film-stocks");
    const m = strictStockMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer, ...(s.aliases ?? [])]);
    let stock: { id: string; manufacturer: string; name: string; iso: number } | null = null;
    if (m.kind === "single") stock = m.item;
    else if (m.kind === "tied") {
      return { content: [{ type: "text" as const, text: `Film "${film}" is ambiguous. Tied: ${m.items.map((s) => displayStock(s.manufacturer, s.name)).join(", ")}. Be more specific.` }] };
    } else {
      if (!manufacturer || !iso) {
        return { content: [{ type: "text" as const, text: `Film stock "${film}" not found. To create it on the fly, pass manufacturer + iso (+ optional type).` }] };
      }
      const created = await api<{ data: { id: string; manufacturer: string; name: string; iso: number } }>("/film-stocks", {
        method: "POST",
        body: JSON.stringify({ manufacturer, name: cleanStockName(film, manufacturer), iso, type: type || "bw" }),
      });
      stock = created.data;
    }

    let cameraId: string | undefined;
    let cameraLabel = "";
    if (camera) {
      const { data: cams } = await api<{ data: Array<{ id: string; make: string; model: string }> }>("/cameras");
      const m = rankedMatch(camera, cams, (c) => [`${c.make} ${c.model}`, c.model, c.make]);
      if (m.kind === "none") {
        return { content: [{ type: "text" as const, text: `Camera "${camera}" not found. Known: ${cams.map((c) => `${c.make} ${c.model}`).join(", ")}.` }] };
      }
      if (m.kind === "tied") {
        return { content: [{ type: "text" as const, text: `Camera "${camera}" is ambiguous. Tied matches: ${m.items.map((c) => `${c.make} ${c.model}`).join(", ")}.` }] };
      }
      cameraId = m.item.id;
      cameraLabel = ` in ${m.item.make} ${m.item.model}`;
    }

    const body: Record<string, unknown> = { filmStockId: stock.id, format: fmt };
    if (cameraId) body.cameraId = cameraId;
    if (ratedIso != null) body.ratedIso = ratedIso;
    if (shotDate) body.shotDate = shotDate;
    if (fieldSeq != null) body.fieldSeq = fieldSeq;
    if (devShorthand) {
      body.devShorthand = devShorthand;
      // If shorthand is a single letter+number (HC-110 codes), default the developer.
      if (/^[A-Ha-h]\d/.test(devShorthand) && !intendedDeveloper) {
        body.intendedDeveloper = "HC-110";
      }
    }
    if (intendedDeveloper) body.intendedDeveloper = intendedDeveloper;
    if (note) body.note = note;
    if (tags?.length) body.tags = tags;
    if (form) body.form = form;
    if (frameCount != null) body.frameCount = frameCount;

    const { data } = await api<{ data: { id: string; displayId: string | null; ratedIso: number } }>("/rolls/log-shot", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const isoText = data.ratedIso !== stock.iso ? `box ${stock.iso}, rated ${data.ratedIso}` : `ISO ${stock.iso}`;
    const idLabel = data.displayId ? `**${data.displayId}**` : `roll ${data.id.slice(0, 8)} (no displayId yet — pass shotDate to assign one)`;
    return {
      content: [{
        type: "text" as const,
        text: `Logged ${idLabel}: ${displayStock(stock.manufacturer, stock.name)} (${fmt}, ${isoText})${cameraLabel}. Status: shot.`,
      }],
    };
  }
);

// ── Tool: tomu_dev_candidates ─────────────────────────────────────────


server.tool(
  "tomu_correct_roll",
  "Fix fields on an already-logged roll, found by its CURRENT displayId (e.g. '20260528.01'). " +
    "Corrects the film stock (pass `film`; if the stock isn't in the DB, add manufacturer + iso to create it) " +
    "and/or dates: `newDisplayId` fixes a mis-stamped date/sequence (e.g. a server-timezone error), " +
    "`devDate` (YYYY-MM-DD), `loadedAt`/`unloadedAt` (ISO 8601). Pass only what you want to change.",
  {
    displayId: z.string().describe("Current display ID of the roll to correct (e.g. '20260528.01')"),
    film: z.string().optional().describe("Correct film stock name (e.g. 'Kodak Ektapan'). Omit to change only dates."),
    manufacturer: z.string().optional().describe("Manufacturer if creating a new stock"),
    iso: z.number().int().positive().optional().describe("Box ISO if creating a new stock"),
    type: z.string().optional().describe("Film type if creating a new stock: 'bw' (default), 'color_negative', 'color_positive'"),
    ratedIso: z.number().int().positive().optional().describe("Override rated ISO (defaults to the stock's box ISO when film changes)"),
    newDisplayId: z.string().optional().describe("Corrected display ID, format YYYYMMDD.N (e.g. fix 20260816.01 -> 20260815.01)"),
    devDate: z.string().optional().describe("Corrected develop date, YYYY-MM-DD"),
    loadedAt: z.string().optional().describe("Corrected load timestamp, ISO 8601"),
    unloadedAt: z.string().optional().describe("Corrected unload timestamp, ISO 8601"),
  },
  async ({ displayId, film, manufacturer, iso, type, ratedIso, newDisplayId, devDate, loadedAt, unloadedAt }) => {
    // Find roll by displayId (scan all statuses)
    const { data: allRolls } = await api<{ data: Array<{ id: string; displayId: string | null }> }>("/rolls?status=all");
    const roll = allRolls.find((r) => r.displayId === displayId);
    if (!roll) {
      return { content: [{ type: "text" as const, text: `No roll with displayId "${displayId}".` }] };
    }

    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    // Optional film-stock correction
    if (film) {
      const { data: stocks } = await api<{ data: Array<{ id: string; manufacturer: string; name: string; iso: number; aliases?: string[] }> }>("/film-stocks");
      const m = strictStockMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer, ...(s.aliases ?? [])]);
      let stock: { id: string; manufacturer: string; name: string; iso: number } | null = null;
      if (m.kind === "single") stock = m.item;
      else if (m.kind === "tied") {
        return { content: [{ type: "text" as const, text: `Film "${film}" is ambiguous. Tied: ${m.items.map((s) => `${s.manufacturer} ${s.name}`).join(", ")}.` }] };
      } else {
        if (!manufacturer || !iso) {
          return { content: [{ type: "text" as const, text: `Stock "${film}" not found. Pass manufacturer + iso to create it.` }] };
        }
        const created = await api<{ data: { id: string; manufacturer: string; name: string; iso: number } }>("/film-stocks", {
          method: "POST",
          body: JSON.stringify({ manufacturer, name: cleanStockName(film, manufacturer), iso, type: type || "bw" }),
        });
        stock = created.data;
      }
      patch.filmStockId = stock.id;
      patch.ratedIso = ratedIso ?? stock.iso;
      changed.push(`stock → ${stock.manufacturer} ${stock.name} (ISO ${patch.ratedIso})`);
    } else if (ratedIso != null) {
      patch.ratedIso = ratedIso;
      changed.push(`rated ISO → ${ratedIso}`);
    }

    // Optional date corrections
    if (newDisplayId != null) { patch.displayId = newDisplayId; changed.push(`display ID → ${newDisplayId}`); }
    if (devDate != null) { patch.devDate = devDate; changed.push(`dev date → ${devDate}`); }
    if (loadedAt != null) { patch.loadedAt = loadedAt; changed.push(`loaded → ${loadedAt}`); }
    if (unloadedAt != null) { patch.unloadedAt = unloadedAt; changed.push(`unloaded → ${unloadedAt}`); }

    if (Object.keys(patch).length === 0) {
      return { content: [{ type: "text" as const, text: `Nothing to change. Pass film and/or a date field (newDisplayId, devDate, loadedAt, unloadedAt).` }] };
    }

    await api(`/rolls/${roll.id}`, { method: "PATCH", body: JSON.stringify(patch) });

    return {
      content: [{ type: "text" as const, text: `Roll **${displayId}** corrected: ${changed.join("; ")}.` }],
    };
  }
);

// ── Tool: tomu_set_stock_aliases ──────────────────────────────────────

}
