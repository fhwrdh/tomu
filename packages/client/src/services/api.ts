const API_BASE = "/api/v1";

let authToken: string | null = localStorage.getItem("filmlog_token");

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem("filmlog_token", token);
  } else {
    localStorage.removeItem("filmlog_token");
  }
}

export function getToken() {
  return authToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
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
} from "@filmlog/shared";

export const cameras = crudApi<Camera, CreateCamera, UpdateCamera>("/cameras");
export const lenses = crudApi<Lens, CreateLens, UpdateLens>("/lenses");
export const filmStocks = crudApi<FilmStock & { totalRolls: number }, CreateFilmStock, UpdateFilmStock>("/film-stocks");
export const inventory = {
  ...crudApi<FilmInventoryItem & { manufacturer: string; stockName: string; iso: number; filmType: string; format: string }, CreateFilmInventoryItem, UpdateFilmInventoryItem>("/inventory"),
  summary: () =>
    request<{
      data: {
        totalRolls: number;
        byStock: Array<{
          filmStockId: string;
          manufacturer: string;
          stockName: string;
          iso: number;
          filmType: string;
          format: string;
          totalRolls: number;
        }>;
        expiringSoon: Array<{
          id: string;
          manufacturer: string;
          stockName: string;
          format: string;
          quantity: number;
          expirationDate: string;
          storageLocation: string;
        }>;
      };
    }>("/inventory/summary"),
};
