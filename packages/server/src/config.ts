import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3456),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("postgres://filmlog:filmlog@localhost:5432/filmlog"),
  JWT_SECRET: z.string().default("dev-secret-change-me"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  /** Root for uploaded files (capture photos). Served at /uploads by fastify-static in dev and nginx in prod. */
  UPLOADS_DIR: z.string().default(fileURLToPath(new URL("../../../uploads", import.meta.url))),
  /** Enables tier-2 (Claude) parsing of field events. Unset → tier 2 skipped. */
  ANTHROPIC_API_KEY: z.string().optional(),
  FIELD_PARSE_MODEL: z.string().default("claude-haiku-4-5"),
});

export const config = envSchema.parse(process.env);
