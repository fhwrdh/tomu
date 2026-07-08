#!/usr/bin/env node

/**
 * Remote entry point: Tomu MCP over Streamable HTTP.
 *
 * Lets the Claude mobile/web app reach Tomu as a custom connector — field
 * capture from a phone ("pit of success": the log is wherever you are).
 *
 * Auth (either satisfies):
 *   - `Authorization: Bearer <TOMU_MCP_TOKEN>` header
 *   - secret URL path: /<TOMU_MCP_PATH_SECRET>/mcp  (for connector UIs that
 *     only accept a URL)
 *
 * Env:
 *   MCP_PORT              listen port (default 3457, loopback — nginx fronts it)
 *   TOMU_MCP_TOKEN        bearer token (optional if path secret set)
 *   TOMU_MCP_PATH_SECRET  URL path secret (optional if token set)
 *   TOMU_API_URL / TOMU_API_TOKEN  as for the stdio server
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.MCP_PORT || 3457);
const TOKEN = process.env.TOMU_MCP_TOKEN || "";
const PATH_SECRET = process.env.TOMU_MCP_PATH_SECRET || "";

if (!TOKEN && !PATH_SECRET) {
  console.error("Refusing to start unauthenticated: set TOMU_MCP_TOKEN and/or TOMU_MCP_PATH_SECRET.");
  process.exit(1);
}

/** Constant-time string comparison — secrets must not leak length/prefix timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function pathSecretSegment(url: string): string {
  // "/<secret>/mcp" → "<secret>"; anything else → ""
  const m = url.split("?")[0].match(/^\/([^/]+)\/mcp$/);
  return m ? m[1] : "";
}

function authorized(req: IncomingMessage): boolean {
  const auth = req.headers.authorization ?? "";
  if (TOKEN && auth.startsWith("Bearer ") && safeEqual(auth.slice(7), TOKEN)) return true;
  if (PATH_SECRET && safeEqual(pathSecretSegment(req.url ?? ""), PATH_SECRET)) return true;
  return false;
}

/** Path is /mcp or /<secret>/mcp; anything else 404s. */
function isMcpPath(url: string): boolean {
  const path = url.split("?")[0];
  return path === "/mcp" || (PATH_SECRET !== "" && safeEqual(pathSecretSegment(path), PATH_SECRET));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 4 * 1024 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", reject);
  });
}

// One transport (and McpServer) per session, keyed by mcp-session-id.
const transports = new Map<string, StreamableHTTPServerTransport>();

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!isMcpPath(req.url ?? "")) {
    res.writeHead(404).end("not found");
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("unauthorized");
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const body = req.method === "POST" ? await readBody(req) : undefined;

  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    const isInit =
      req.method === "POST" &&
      body != null &&
      (Array.isArray(body)
        ? body.some((m) => m?.method === "initialize")
        : (body as { method?: string }).method === "initialize");
    if (!isInit) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session. Send initialize first." }, id: null }));
      return;
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport!);
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };
    const server = createServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, body);
}

const httpServer = createHttpServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("request error:", err);
    if (!res.headersSent) res.writeHead(500).end("internal error");
  });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.error(`tomu-mcp http listening on 127.0.0.1:${PORT} (auth: ${TOKEN ? "bearer" : ""}${TOKEN && PATH_SECRET ? "+" : ""}${PATH_SECRET ? "path-secret" : ""})`);
});
