import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3456),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("postgres://tomu:tomu@localhost:5432/tomu"),
  JWT_SECRET: z.string().default("dev-secret-change-me"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
});

export const config = envSchema.parse(process.env);
