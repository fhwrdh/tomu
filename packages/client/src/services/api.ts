const API_BASE = "/api/v1";

// Read on first use, not at import: importing a module should not touch storage,
// and storage is not always there (private mode, a test environment without it).
let authToken: string | null | undefined;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  authToken = token;
  const store = storage();
  if (!store) return;
  if (token) {
    store.setItem("tomu_token", token);
  } else {
    store.removeItem("tomu_token");
  }
}

export function getToken(): string | null {
  if (authToken === undefined) authToken = storage()?.getItem("tomu_token") ?? null;
  return authToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    // Only when there is a body: Fastify rejects a bodyless request that
    // declares application/json with "Body cannot be empty" — a 400 that looks
    // like a server fault and is not.
    ...(options.body != null ? { "Content-Type": "application/json" } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Auth ──

export const auth = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string; displayName?: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) }
    ),
  register: (email: string, password: string, displayName?: string) =>
    request<{ token: string; user: { id: string; email: string; displayName?: string } }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify({ email, password, displayName }) }
    ),
  me: () =>
    request<{ user: { id: string; email: string; displayName?: string } }>("/auth/me"),
};

// ── Generic CRUD helpers ──

function crudApi<T, C, U>(basePath: string) {
  return {
    list: () => request<{ data: T[] }>(basePath),
    get: (id: string) => request<{ data: T }>(`${basePath}/${id}`),
    create: (body: C) =>
      request<{ data: T }>(basePath, { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: U) =>
      request<{ data: T }>(`${basePath}/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) =>
      request<void>(`${basePath}/${id}`, { method: "DELETE" }),
  };
}

// ── Resources ──

import type {
  Camera, CreateCamera, UpdateCamera,
  Lens, CreateLens, UpdateLens,
  FilmStock, CreateFilmStock, UpdateFilmStock,
  FilmInventoryItem, CreateFilmInventoryItem, UpdateFilmInventoryItem,
  Roll, CreateRoll,
  Frame, CreateFrame,
  Note, CreateNote,
  FieldEvent,
  DilutionResult,
} from "@tomu/shared";

export const cameras = crudApi<Camera, CreateCamera, UpdateCamera>("/cameras");
export const lenses = crudApi<Lens, CreateLens, UpdateLens>("/lenses");
export const filmStocks = crudApi<FilmStock, CreateFilmStock, UpdateFilmStock>("/film-stocks");

export type InventoryItemWithStock = FilmInventoryItem & {
  manufacturer: string;
  stockName: string;
  iso: number;
  filmType: string;
};

export const inventory = {
  ...crudApi<InventoryItemWithStock, CreateFilmInventoryItem, UpdateFilmInventoryItem>("/inventory"),
  summary: () =>
    request<{
      data: {
        items: InventoryItemWithStock[];
        expiringSoon: InventoryItemWithStock[];
      };
    }>("/inventory/summary"),
};

// ── Rolls ──

/** A roll row as returned by GET /rolls with joined stock+camera fields and a computed frames-shot count. */
export type RollListItem = Roll & {
  manufacturer: string;
  stockName: string;
  iso: number;
  filmType: string;
  cameraMake: string | null;
  cameraModel: string | null;
  framesShot: number;
};

export type RollDetail = RollListItem & {
  frames: Frame[];
  notes: Note[];
  frameNotes: Note[];
  unpinnedEvents: (FieldEvent & { shortId: string })[];
};

export const rolls = {
  list: (status?: string) =>
    request<{ data: RollListItem[] }>(`/rolls${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  get: (id: string) => request<{ data: RollDetail }>(`/rolls/${id}`),
  load: (body: CreateRoll) =>
    request<{ data: Roll }>("/rolls", { method: "POST", body: JSON.stringify(body) }),
  unload: (id: string, body?: { localDate?: string; note?: string }) =>
    request<{ data: Roll }>(`/rolls/${id}/unload`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  undoLoad: (id: string) => request<void>(`/rolls/${id}`, { method: "DELETE" }),
  addFrame: (id: string, body: CreateFrame) =>
    request<{ data: Frame }>(`/rolls/${id}/frames`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addNote: (id: string, body: CreateNote) =>
    request<{ data: Note }>(`/rolls/${id}/notes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addFrameNote: (id: string, frameNumber: number, body: CreateNote) =>
    request<{ data: Note }>(`/rolls/${id}/frames/${frameNumber}/notes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// ── Field events ──

export const fieldEvents = {
  /** Turns a note into a frame: settings copied over, transcript attached as a note. */
  pin: (id: string, body: { frameNumber: number; rollId?: string }) =>
    request<{ data: { event: FieldEvent; frame: Frame; joined: boolean } }>(
      `/field-events/${id}/pin`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  /** Attaches to the roll with no frame — a thought, or a phone snap of something not shot on film. */
  rollLevel: (id: string, body: { rollId?: string } = {}) =>
    request<{ data: { event: FieldEvent } }>(`/field-events/${id}/roll-level`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Pending notes delete outright; pinned ones need force and keep their frame. */
  remove: (id: string, force = false) =>
    request<void>(`/field-events/${id}${force ? "?force=true" : ""}`, { method: "DELETE" }),
};

// ── Dev pipeline ──
// Shapes mirror the server's services/dev-candidates.ts and services/tank-plan.ts.
// They are declared here rather than imported because those types live in the
// server package, not @tomu/shared. Dates arrive as ISO strings over the wire.

export interface CandidateRoll {
  id: string;
  displayId: string | null;
  filmStockId: string;
  ratedIso: number | null;
  format: string;
  manufacturer: string;
  stockName: string;
  stockIso: number;
  loadedAt: string | null;
  tags: string[];
  intendedDeveloper: string | null;
  intendedDilution: string | null;
  intendedDilutionRaw: string | null;
  intendedDevTimeSeconds: number | null;
}

export interface CandidateRecipe {
  developer: string | null;
  dilution: string | null;
  devTimeSeconds: number | null;
  temperatureC: string | null;
  mdcAsaIso?: number | null;
}

export type CandidateTier = "intended" | "history" | "mdc" | "stock-iso";

export interface CandidateGroup {
  recipeKey: string;
  tier: CandidateTier;
  recipe: CandidateRecipe | null;
  rolls: CandidateRoll[];
}

export interface PlannedLoad {
  tankName: string;
  tankVolumeMl: number;
  tier: CandidateTier;
  recipe: CandidateRecipe;
  rolls: CandidateRoll[];
  usedUnits: number;
  capacityUnits: number;
  oldestLoadedAt: string | null;
  mix: DilutionResult | null;
  warnings: string[];
  score: number;
}

export interface TankPlan {
  loads: PlannedLoad[];
  remainder: { roll: CandidateRoll; reason: string }[];
  warnings: string[];
}

export interface TankPlanRequest {
  tanksAvailable?: string[];
  excludeTanks?: string[];
  maxTanks?: number;
  includeRolls?: string[];
  tags?: string[];
  developer?: string;
}

export const devSessions = {
  candidates: () => request<{ data: CandidateGroup[] }>("/dev-sessions/candidates"),
};

/** A tank row as returned by GET /tanks. reelUnits arrives as a numeric string. */
export interface Tank {
  id: string;
  name: string;
  kind: "roll" | "sheet";
  volumeMl: number;
  reelUnits: string | null;
  sheetCapacity: number | null;
  quantity: number;
  agitation: string;
  notes: string | null;
  isActive: boolean;
}

export const tanks = {
  list: () => request<{ data: Tank[] }>("/tanks"),
  plan: (body: TankPlanRequest = {}) =>
    request<{ data: TankPlan }>("/tanks/plan", { method: "POST", body: JSON.stringify(body) }),
};
