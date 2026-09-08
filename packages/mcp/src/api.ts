// ── API client ──
//
// Every tool reaches Tomu through the same public API the PWA uses: no database
// access here, so the agent can do nothing a UI client could not.

export const API_BASE = process.env.TOMU_API_URL || "http://localhost:3456/api/v1";

export const API_TOKEN = process.env.TOMU_API_TOKEN || "";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_TOKEN}`,
    ...((options.headers as Record<string, string>) || {}),
  };
  // Only advertise a JSON body when we actually send one. A DELETE (or any
  // bodyless request) with Content-Type: application/json makes Fastify reject
  // it as "body cannot be empty" (400) — which broke tomu_undo_load.
  if (options.body != null) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`API error ${res.status}: ${body.error || res.statusText}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Server ──
//
// createServer() builds a fully tool-registered McpServer. Entry points pick
// the transport: index.ts (stdio, local) and http.ts (streamable HTTP, remote).
// Tool registrations below are intentionally not re-indented — everything down
// to the closing `return server` is the factory body.
