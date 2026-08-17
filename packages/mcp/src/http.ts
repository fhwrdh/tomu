#!/usr/bin/env node

/**
 * Remote entry point: Tomu MCP over Streamable HTTP, with an OAuth 2.1
 * authorization server (for the claude.ai connector) and a legacy
 * static-token / path-secret fallback (for Claude Code / headless).
 *
 * Env:
 *   MCP_PORT              listen port (default 3457, loopback — nginx fronts it)
 *   OAUTH_ISSUER_URL      public https base, e.g. https://film.fhwrdh.net
 *   DATABASE_URL          Postgres (OAuth client/code/token storage)
 *   TOMU_API_URL/_TOKEN   app API (tool calls + login verification)
 *   TOMU_MCP_TOKEN        legacy static bearer (optional fallback)
 *   TOMU_MCP_PATH_SECRET  legacy URL path secret (optional fallback)
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { createServer } from "./server.js";
import { handleConsent, tomuOAuthProvider } from "./oauth/provider.js";

const PORT = Number(process.env.MCP_PORT || 3457);
const ISSUER = process.env.OAUTH_ISSUER_URL || `http://localhost:${PORT}`;
const TOKEN = process.env.TOMU_MCP_TOKEN || "";
const PATH_SECRET = process.env.TOMU_MCP_PATH_SECRET || "";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
function pathSecretSegment(url: string): string {
  const m = url.split("?")[0].match(/^\/([^/]+)\/mcp\/?$/);
  return m ? m[1] : "";
}

// ── shared MCP transport handling (one session per mcp-session-id) ──
const transports = new Map<string, StreamableHTTPServerTransport>();

async function handleMcp(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const body = req.method === "POST" ? req.body : undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    const isInit =
      req.method === "POST" &&
      body != null &&
      (Array.isArray(body)
        ? body.some((m: { method?: string }) => m?.method === "initialize")
        : (body as { method?: string })?.method === "initialize");
    if (!isInit) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session. Send initialize first." },
        id: null,
      });
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
    await createServer().connect(transport);
  }

  await transport.handleRequest(req, res, body);
}

// ── dual-mode auth: OAuth access token, else legacy static bearer / path secret ──
async function authMcp(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (bearer) {
    try {
      (req as Request & { auth?: unknown }).auth = await tomuOAuthProvider.verifyAccessToken(bearer);
      return next();
    } catch {
      /* not an OAuth token — try legacy */
    }
    if (TOKEN && safeEqual(bearer, TOKEN)) return next();
  }
  if (PATH_SECRET && safeEqual(pathSecretSegment(req.originalUrl), PATH_SECRET)) return next();
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`);
  res.status(401).json({ error: "unauthorized" });
}

const app = express();
app.disable("x-powered-by");

// OAuth authorization-server endpoints: metadata, /register (DCR), /authorize, /token, /revoke
app.use(
  mcpAuthRouter({
    provider: tomuOAuthProvider,
    issuerUrl: new URL(ISSUER),
    scopesSupported: ["tomu"],
    resourceName: "Tomu",
  }),
);

// Login-form POST (consent) → issues an authorization code
app.post("/oauth/consent", express.urlencoded({ extended: false }), (req, res) => {
  handleConsent(req, res).catch((e) => {
    console.error("consent error:", e);
    if (!res.headersSent) res.status(500).send("internal error");
  });
});

// MCP endpoint — clean `/mcp` and legacy `/<secret>/mcp`, both dual-auth
const mcpJson = express.json({ limit: "4mb" });
const runMcp = (req: Request, res: Response) =>
  handleMcp(req, res).catch((e) => {
    console.error("mcp error:", e);
    if (!res.headersSent) res.status(500).end("internal error");
  });
app.all("/mcp", authMcp, mcpJson, runMcp);
app.all(/^\/[^/]+\/mcp$/, authMcp, mcpJson, runMcp);

app.listen(PORT, "127.0.0.1", () => {
  console.error(
    `tomu-mcp http on 127.0.0.1:${PORT} — OAuth issuer ${ISSUER}` +
      (TOKEN || PATH_SECRET ? " (+legacy fallback)" : ""),
  );
});
