/**
 * Tomu's OAuth 2.1 authorization-server provider for the MCP endpoint.
 *
 * - Dynamic client registration creates PUBLIC (PKCE-only) clients — matches how
 *   the claude.ai connector registers; no client secret to store or leak.
 * - Consent is a minimal login page verified against the app's existing
 *   /auth/login (bcrypt), so there's one source of truth for credentials.
 * - Access/refresh tokens are opaque and DB-backed (revocable, restart-safe).
 * - PKCE (S256) is validated by the SDK via challengeForAuthorizationCode().
 */
import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidScopeError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import * as store from "./store.js";

const API_BASE = process.env.TOMU_API_URL || "http://localhost:3456/api/v1";
const ACCESS_TTL_S = 3600; // 1h
const REFRESH_TTL_S = 60 * 60 * 24 * 30; // 30d
const CODE_TTL_MS = 60_000; // 1m

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type ConsentFields = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  scope?: string;
  resource?: string;
};

function renderLoginPage(f: ConsentFields & { clientName?: string; error?: string }): string {
  const hidden = (["client_id", "redirect_uri", "code_challenge", "state", "scope", "resource"] as const)
    .map((k) => `<input type="hidden" name="${k}" value="${esc((f as Record<string, unknown>)[k])}">`)
    .join("\n    ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Tomu</title>
<style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#111;color:#eee}
form{background:#1c1c1c;padding:2rem;border-radius:12px;width:min(92vw,340px);box-shadow:0 8px 30px rgba(0,0,0,.4)}
h1{font-size:1.25rem;margin:0 0 .25rem}p{color:#aaa;margin:.25rem 0 1.25rem;font-size:.9rem}
label{display:block;font-size:.8rem;color:#bbb;margin:.75rem 0 .25rem}
input[type=email],input[type=password]{width:100%;padding:.6rem;border:1px solid #333;border-radius:8px;background:#111;color:#eee;box-sizing:border-box}
button{margin-top:1.25rem;width:100%;padding:.7rem;border:0;border-radius:8px;background:#4f7cff;color:#fff;font-weight:600;cursor:pointer}
.err{color:#ff6b6b;font-size:.85rem;margin-top:.75rem}</style></head>
<body><form method="post" action="/oauth/consent">
    <h1>Sign in to Tomu</h1>
    <p>${esc(f.clientName || "An application")} wants to access your Tomu data.</p>
    ${hidden}
    <label>Email</label><input type="email" name="email" autocomplete="username" required autofocus>
    <label>Password</label><input type="password" name="password" autocomplete="current-password" required>
    ${f.error ? `<div class="err">${esc(f.error)}</div>` : ""}
    <button type="submit">Authorize</button>
</form></body></html>`;
}

async function verifyLogin(email: string, password: string): Promise<{ userId: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { id?: string } };
    return data.user?.id ? { userId: data.user.id } : null;
  } catch {
    return null;
  }
}

async function issueTokens(
  clientId: string,
  userId: string,
  scope: string | undefined,
  resource: string | undefined,
  withRefresh = true,
): Promise<OAuthTokens> {
  const now = Date.now();
  const access = store.randomToken();
  await store.insertToken({
    tokenHash: store.sha256(access),
    kind: "access",
    clientId,
    userId,
    scope: scope ?? null,
    resource: resource ?? null,
    expiresAt: new Date(now + ACCESS_TTL_S * 1000),
  });
  const tokens: OAuthTokens = { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, scope };
  if (withRefresh) {
    const refresh = store.randomToken();
    await store.insertToken({
      tokenHash: store.sha256(refresh),
      kind: "refresh",
      clientId,
      userId,
      scope: scope ?? null,
      resource: resource ?? null,
      expiresAt: new Date(now + REFRESH_TTL_S * 1000),
    });
    tokens.refresh_token = refresh;
  }
  return tokens;
}

const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    const r = await store.getClientRow(clientId);
    if (!r) return undefined;
    return {
      client_id: r.clientId,
      redirect_uris: r.redirectUris,
      client_name: r.clientName ?? undefined,
      grant_types: r.grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: r.tokenEndpointAuthMethod,
      scope: r.scope ?? undefined,
      client_id_issued_at: r.clientIdIssuedAt,
      client_secret_expires_at: r.clientSecretExpiresAt ?? undefined,
    };
  },
  async registerClient(client) {
    const clientId = `mcp_${store.randomToken(16)}`;
    const clientIdIssuedAt = Math.floor(Date.now() / 1000);
    const redirectUris = client.redirect_uris ?? [];
    const grantTypes = client.grant_types ?? ["authorization_code", "refresh_token"];
    await store.insertClient({
      clientId,
      clientSecretHash: null,
      clientName: client.client_name ?? null,
      redirectUris,
      grantTypes,
      scope: client.scope ?? null,
      tokenEndpointAuthMethod: "none", // public client; PKCE protects the exchange
      clientIdIssuedAt,
      clientSecretExpiresAt: null,
    });
    return {
      ...client,
      client_id: clientId,
      client_id_issued_at: clientIdIssuedAt,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      token_endpoint_auth_method: "none",
    };
  },
};

export const tomuOAuthProvider: OAuthServerProvider = {
  clientsStore,

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderLoginPage({
        clientName: client.client_name,
        client_id: client.client_id,
        redirect_uri: params.redirectUri,
        code_challenge: params.codeChallenge,
        state: params.state,
        scope: params.scopes?.join(" "),
        resource: params.resource?.href,
      }),
    );
  },

  async challengeForAuthorizationCode(_client, authorizationCode): Promise<string> {
    const challenge = await store.getCodeChallenge(authorizationCode);
    if (!challenge) throw new InvalidGrantError("unknown authorization code");
    return challenge;
  },

  async exchangeAuthorizationCode(client, authorizationCode, _verifier, redirectUri): Promise<OAuthTokens> {
    const row = await store.consumeAuthCode(authorizationCode);
    if (!row || row.clientId !== client.client_id) throw new InvalidGrantError("invalid grant");
    if (redirectUri && row.redirectUri !== redirectUri) throw new InvalidGrantError("redirect_uri mismatch");
    return issueTokens(client.client_id, row.userId, row.scope ?? undefined, row.resource ?? undefined);
  },

  async exchangeRefreshToken(client, refreshToken, scopes): Promise<OAuthTokens> {
    const row = await store.getValidToken(refreshToken, "refresh");
    if (!row || row.clientId !== client.client_id) throw new InvalidGrantError("invalid grant");
    // Requested scopes must be a subset of what was originally granted.
    const granted = row.scope ? row.scope.split(" ") : [];
    const requested = scopes && scopes.length ? scopes : granted;
    if (requested.some((s) => !granted.includes(s))) throw new InvalidScopeError("requested scope exceeds granted scope");
    const scope = requested.length ? requested.join(" ") : undefined;
    // Rotate: revoke the presented refresh token and issue a fresh access+refresh pair.
    await store.revokeToken(refreshToken);
    return issueTokens(client.client_id, row.userId, scope, row.resource ?? undefined, true);
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    const row = await store.getValidToken(token, "access");
    if (!row) throw new InvalidTokenError("invalid or expired token");
    return {
      token,
      clientId: row.clientId,
      scopes: row.scope ? row.scope.split(" ") : [],
      expiresAt: row.expiresAt ? Math.floor(row.expiresAt.getTime() / 1000) : undefined,
      extra: { userId: row.userId },
    };
  },

  async revokeToken(_client, request: OAuthTokenRevocationRequest): Promise<void> {
    await store.revokeToken(request.token);
  },
};

/** Express handler for the login form POST — verifies the user and issues an auth code. */
export async function handleConsent(req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, string>;
  const fields: ConsentFields = {
    client_id: b.client_id,
    redirect_uri: b.redirect_uri,
    code_challenge: b.code_challenge,
    state: b.state,
    scope: b.scope,
    resource: b.resource,
  };

  const client = await store.getClientRow(fields.client_id);
  if (!client || !client.redirectUris.includes(fields.redirect_uri) || !fields.code_challenge) {
    res.status(400).send("invalid authorization request");
    return;
  }

  const login = await verifyLogin(b.email ?? "", b.password ?? "");
  if (!login) {
    res.status(401).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderLoginPage({ ...fields, clientName: client.clientName ?? undefined, error: "Invalid email or password." }));
    return;
  }

  const code = store.randomToken();
  await store.insertAuthCode({
    codeHash: store.sha256(code),
    clientId: fields.client_id,
    userId: login.userId,
    redirectUri: fields.redirect_uri,
    codeChallenge: fields.code_challenge,
    codeChallengeMethod: "S256",
    scope: fields.scope || null,
    resource: fields.resource || null,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const url = new URL(fields.redirect_uri);
  url.searchParams.set("code", code);
  if (fields.state) url.searchParams.set("state", fields.state);
  res.redirect(url.toString());
}
