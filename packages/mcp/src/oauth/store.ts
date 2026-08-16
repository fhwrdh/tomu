/**
 * OAuth persistence for the MCP authorization server.
 *
 * Clients / auth codes / tokens live in the same Postgres as the app (tables
 * defined in @tomu/server schema). Codes and tokens are stored HASHED — the
 * plaintext is returned to the client exactly once, at issuance.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { oauthAuthCodes, oauthClients, oauthTokens } from "@tomu/server/schema";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://filmlog:filmlog@localhost:5432/filmlog";

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
const db = drizzle(pool, { schema: { oauthClients, oauthAuthCodes, oauthTokens } });

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export type ClientRow = typeof oauthClients.$inferSelect;
export type ClientInsert = typeof oauthClients.$inferInsert;
export type CodeInsert = typeof oauthAuthCodes.$inferInsert;
export type TokenInsert = typeof oauthTokens.$inferInsert;

// ── clients ──
export async function getClientRow(clientId: string): Promise<ClientRow | undefined> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  return row;
}
export async function insertClient(c: ClientInsert): Promise<void> {
  await db.insert(oauthClients).values(c);
}

// ── auth codes ──
export async function insertAuthCode(c: CodeInsert): Promise<void> {
  await db.insert(oauthAuthCodes).values(c);
}
/** Peek the stored PKCE challenge for a code (used by the SDK before exchange). */
export async function getCodeChallenge(codePlain: string): Promise<string | undefined> {
  const [row] = await db
    .select({ codeChallenge: oauthAuthCodes.codeChallenge })
    .from(oauthAuthCodes)
    .where(eq(oauthAuthCodes.codeHash, sha256(codePlain)))
    .limit(1);
  return row?.codeChallenge;
}
/** Fetch and consume (single-use) a code. Returns undefined if missing or expired. */
export async function consumeAuthCode(codePlain: string) {
  const codeHash = sha256(codePlain);
  const [row] = await db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, codeHash)).limit(1);
  await db.delete(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, codeHash));
  if (!row) return undefined;
  if (row.expiresAt.getTime() < Date.now()) return undefined;
  return row;
}

// ── tokens ──
export async function insertToken(t: TokenInsert): Promise<void> {
  await db.insert(oauthTokens).values(t);
}
export async function getValidToken(tokenPlain: string, kind: "access" | "refresh") {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, sha256(tokenPlain)), eq(oauthTokens.kind, kind), isNull(oauthTokens.revokedAt)))
    .limit(1);
  if (!row) return undefined;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return undefined;
  return row;
}
export async function revokeToken(tokenPlain: string): Promise<void> {
  await db.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.tokenHash, sha256(tokenPlain)));
}

/** Best-effort cleanup of expired codes/tokens; call periodically. */
export async function purgeExpired(): Promise<void> {
  const now = new Date();
  await db.delete(oauthAuthCodes).where(lt(oauthAuthCodes.expiresAt, now));
  await db.delete(oauthTokens).where(lt(oauthTokens.expiresAt, now));
}
