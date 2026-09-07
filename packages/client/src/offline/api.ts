/**
 * The real network for the sync worker, over the app's existing fetch wrapper
 * (so it carries the JWT and raises `ApiError` with a status, which the worker
 * uses to tell "the note is wrong" from "the network is down").
 */
import { ApiError, getToken } from "../services/api.js";
import type { GearCache } from "./db.js";
import type { RemoteEvent, SyncApi } from "./sync.js";

const API_BASE = "/api/v1";

async function json<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const syncApi: SyncApi = {
  async createEvent(body) {
    const { data } = await json<{ data: RemoteEvent }>("/field-events", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return data;
  },

  async uploadPhoto(serverId, blob, mimeType) {
    const token = getToken();
    const form = new FormData();
    // The route wants exactly one part named "file", and only image/jpeg. The
    // type is re-applied here because storage can drop a Blob's own type.
    form.append("file", new File([blob], `${serverId}.jpg`, { type: mimeType }), `${serverId}.jpg`);
    const res = await fetch(`${API_BASE}/field-events/${serverId}/photo`, {
      method: "POST",
      // No Content-Type: the browser sets the multipart boundary itself.
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error || res.statusText);
    }
    return res.json();
  },

  async fetchEvents(clientIds) {
    if (clientIds.length === 0) return [];
    const { data } = await json<{ data: RemoteEvent[] }>(
      `/field-events?client_ids=${clientIds.map(encodeURIComponent).join(",")}`,
    );
    return data;
  },

  async deleteEvent(serverId) {
    await json<void>(`/field-events/${serverId}`, { method: "DELETE" });
  },

  async fetchGear() {
    const [cameras, lenses, rolls] = await Promise.all([
      json<{ data: Array<{ id: string; make: string; model: string }> }>("/cameras"),
      json<{ data: Array<{ id: string; make: string; model: string; focalLengthMm?: number }> }>("/lenses"),
      json<{ data: Array<{ id: string; cameraId?: string; manufacturer: string; stockName: string; framesShot: number; frameCount: number }> }>("/rolls?status=loaded"),
    ]);
    const gear: Omit<GearCache, "id" | "refreshedAt"> = {
      cameras: cameras.data.map((c) => ({ id: c.id, label: `${c.make} ${c.model}` })),
      lenses: lenses.data.map((l) => ({
        id: l.id,
        label: `${l.make} ${l.model}${l.focalLengthMm != null ? ` ${l.focalLengthMm}mm` : ""}`,
      })),
      activeRolls: rolls.data.map((r) => ({
        id: r.id,
        cameraId: r.cameraId ?? null,
        label: `${r.manufacturer} ${r.stockName}`,
        framesShot: r.framesShot,
        frameCount: r.frameCount,
      })),
    };
    return gear;
  },
};
