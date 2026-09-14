// ── Streamable HTTP session routing ──
//
// What to do with a request, given its Mcp-Session-Id and whether we still hold that
// session. Split out of http.ts so it can be tested without starting a server.
//
// Sessions live in memory, so every deploy forgets all of them. The status code is what
// lets a client recover from that on its own. MCP spec 2025-06-18, Session Management:
// a request carrying a session ID the server no longer has MUST get 404, and a client
// that receives 404 MUST start a new session. A 400 there leaves the client resending a
// dead ID forever — which is what the claude.ai connector did after every deploy.

export type SessionRoute =
  | { kind: "existing" }
  | { kind: "initialize" }
  | { kind: "reject"; status: 400 | 404; message: string };

export function routeSession(input: {
  sessionId: string | undefined;
  known: boolean;
  isInitialize: boolean;
}): SessionRoute {
  const { sessionId, known, isInitialize } = input;
  if (sessionId && known) return { kind: "existing" };
  // Initialize always opens a fresh session, even if a stale ID rode along with it.
  if (isInitialize) return { kind: "initialize" };
  if (sessionId) {
    return { kind: "reject", status: 404, message: "Session not found. Send initialize to start a new session." };
  }
  return { kind: "reject", status: 400, message: "No valid session. Send initialize first." };
}

/** True when a JSON-RPC body (single message or batch) contains an initialize request. */
export function containsInitialize(body: unknown): boolean {
  const isInit = (m: unknown) => (m as { method?: string } | null)?.method === "initialize";
  return Array.isArray(body) ? body.some(isInit) : isInit(body);
}
