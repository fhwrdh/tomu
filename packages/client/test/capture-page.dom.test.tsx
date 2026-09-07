/**
 * Capture screen behaviour. Lives in the `client-dom` project (jsdom).
 * The store underneath is exercised in capture-store.test.ts; what matters here
 * is that talking, correcting, and saving behave the way a wet hand on a phone
 * in the rain needs them to.
 */
import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturePage } from "../src/components/capture/CapturePage.js";
import { db } from "../src/offline/db.js";
import { saveGear } from "../src/offline/store.js";

vi.mock("../src/hooks/useSyncWorker.js", () => ({
  useSyncWorker: () => ({ syncNow: vi.fn(async () => null), syncing: false, lastResult: null }),
}));

/** The load/unload dialogs the header opens are TanStack Query components. */
function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const gear = {
  cameras: [{ id: "cam-m6", label: "Leica M6" }],
  lenses: [{ id: "lens-35", label: "Leica Summicron 35mm" }],
  activeRolls: [
    { id: "roll-1", cameraId: "cam-m6", cameraLabel: "Leica M6", label: "Ilford Pan F", framesShot: 11, frameCount: 36 },
  ],
};

beforeEach(async () => {
  await db.open();
  await db.events.clear();
  await db.blobs.clear();
  await db.deletes.clear();
  await db.cameraState.clear();
  // This jsdom environment has no localStorage; the page guards for that too.
  try { localStorage?.clear(); } catch { /* nothing to clear */ }
  await saveGear(db, gear);
});

afterEach(() => {
  cleanup();
});

describe("the header", () => {
  it("leads with the camera and shows what is loaded in it", async () => {
    render(<CapturePage />);

    expect(await screen.findByRole("combobox", { name: "Camera" })).toHaveValue("cam-m6");
    expect(screen.getByTestId("roll-state").textContent).toContain("Ilford Pan F · 11/36");
  });

  it("shows the roll for the selected camera, not just the first one", async () => {
    // A roll flips to "shooting" on its first frame; mid-roll is the normal case.
    await saveGear(db, {
      ...gear,
      cameras: [...gear.cameras, { id: "cam-rb", label: "Mamiya RB67" }],
      activeRolls: [
        ...gear.activeRolls,
        { id: "roll-2", cameraId: "cam-rb", cameraLabel: "Mamiya RB67", label: "HP5 Plus", framesShot: 4, frameCount: 10 },
      ],
    });
    const user = userEvent.setup();
    render(<CapturePage />);

    await user.selectOptions(await screen.findByRole("combobox", { name: "Camera" }), "cam-rb");
    await waitFor(() => expect(screen.getByTestId("roll-state").textContent).toContain("HP5 Plus · 4/10"));
  });

  it("says the camera is empty without blocking capture", async () => {
    await saveGear(db, { ...gear, activeRolls: [] });
    render(<CapturePage />);

    // The camera is picked once the gear cache loads, a tick after first paint.
    await waitFor(() =>
      expect(screen.getByTestId("roll-state").textContent).toContain("No roll in the Leica M6"),
    );
    expect(screen.getByRole("textbox", { name: "Field note" })).toBeDefined();
  });

  it("switches camera when one is named out loud", async () => {
    await saveGear(db, {
      ...gear,
      cameras: [...gear.cameras, { id: "cam-rb", label: "Mamiya RB67" }],
    });
    const user = userEvent.setup();
    render(<CapturePage />);

    await user.type(await screen.findByRole("textbox", { name: "Field note" }), "on the mamiya, wide open");

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Camera" })).toHaveValue("cam-rb"),
    );
  });
});

describe("a film change with no signal", () => {
  it("stops attaching notes to a roll that is no longer in the camera", async () => {
    const user = userEvent.setup();
    render(<CapturePage />);

    await user.click(await screen.findByRole("button", { name: "Film changed" }));
    await waitFor(() =>
      expect(screen.getByTestId("roll-state").textContent).toContain("Film changed"),
    );

    await user.type(screen.getByRole("textbox", { name: "Field note" }), "first frame of the new roll");
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(async () => {
      const [saved] = await db.events.toArray();
      // Loose, deliberately: a wrong roll is worse than no roll.
      expect(saved.rollId).toBeNull();
    });
  });
});

describe("live parsing", () => {
  it("renders the expected chips as empty before anything is said", async () => {
    render(<CapturePage />);
    await screen.findByTestId("field-chips");

    for (const key of ["camera", "frame", "shutter", "aperture"]) {
      expect(screen.getByTestId(`chip-${key}`).dataset.empty).toBe("true");
    }
  });

  it("fills chips as the words arrive", async () => {
    const user = userEvent.setup();
    render(<CapturePage />);

    await user.type(
      await screen.findByRole("textbox", { name: "Field note" }),
      "on the m6, frame twelve, one two-fifty at f8",
    );

    await waitFor(() => {
      expect(screen.getByTestId("chip-shutter").textContent).toContain("1/250");
    });
    expect(screen.getByTestId("chip-aperture").textContent).toContain("f/8");
    expect(screen.getByTestId("chip-frame").textContent).toContain("12");
    expect(screen.getByTestId("chip-camera").textContent).toContain("Leica M6");
  });
});

describe("saving", () => {
  it("stores the note, clears the field, and shows what was saved", async () => {
    const user = userEvent.setup();
    render(<CapturePage />);

    const field = await screen.findByRole("textbox", { name: "Field note" });
    await user.type(field, "fog on the ferry deck");
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(async () => expect(await db.events.count()).toBe(1));
    const [saved] = await db.events.toArray();
    expect(saved.transcript).toBe("fog on the ferry deck");
    expect(saved.rollId).toBe("roll-1");
    expect(field).toHaveValue("");
    expect((await screen.findByTestId("last-saved")).textContent).toContain("fog on the ferry deck");
  });

  it("saves on blur, so a note in progress is never lost", async () => {
    const user = userEvent.setup();
    render(<CapturePage />);

    await user.type(await screen.findByRole("textbox", { name: "Field note" }), "half a thought");
    await user.tab();

    await waitFor(async () => expect(await db.events.count()).toBe(1));
  });

  it("saves nothing for an empty field", async () => {
    const user = userEvent.setup();
    render(<CapturePage />);

    await user.click(await screen.findByRole("textbox", { name: "Field note" }));
    await user.tab();

    expect(await db.events.count()).toBe(0);
  });

  it("marks a cleared chip as hand-edited so a re-parse cannot undo it", async () => {
    const user = userEvent.setup();
    render(<CapturePage />);

    await user.type(await screen.findByRole("textbox", { name: "Field note" }), "at 250 f8");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByTestId("last-saved");

    const saved = await screen.findByTestId("last-saved");
    const clear = await waitFor(() =>
      saved.querySelector<HTMLButtonElement>('button[aria-label="Clear aperture"]')!,
    );
    await user.click(clear);

    await waitFor(async () => {
      const [row] = await db.events.toArray();
      expect(row.editedFields).toContain("aperture");
      expect(row.aperture).toBeNull();
    });
  });
});
