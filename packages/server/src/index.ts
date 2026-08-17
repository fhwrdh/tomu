import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { camerasRoutes } from "./routes/cameras.js";
import { filmInventoryRoutes } from "./routes/film-inventory.js";
import { filmStocksRoutes } from "./routes/film-stocks.js";
import { lensesRoutes } from "./routes/lenses.js";
import { devSessionsRoutes } from "./routes/dev-sessions.js";
import { rollsRoutes } from "./routes/rolls.js";
import { tanksRoutes } from "./routes/tanks.js";

const fastify = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
  },
});

// Plugins
await fastify.register(cors, { origin: config.CORS_ORIGIN });
await fastify.register(jwt, { secret: config.JWT_SECRET });
await fastify.register(authPlugin);

// Map validation errors (routes parse request bodies with Zod `.parse()`) to 400
// instead of the default unhandled-throw 500. Everything else keeps its status.
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: "Validation failed",
      details: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
    });
  }
  const e = error as { statusCode?: number; message?: string };
  const statusCode = e.statusCode ?? 500;
  if (statusCode >= 500) request.log.error(error);
  return reply.status(statusCode).send({ error: e.message || "Internal Server Error" });
});

// Routes
await fastify.register(authRoutes, { prefix: "/api/v1/auth" });
await fastify.register(camerasRoutes, { prefix: "/api/v1/cameras" });
await fastify.register(lensesRoutes, { prefix: "/api/v1/lenses" });
await fastify.register(filmStocksRoutes, { prefix: "/api/v1/film-stocks" });
await fastify.register(filmInventoryRoutes, { prefix: "/api/v1/inventory" });
await fastify.register(rollsRoutes, { prefix: "/api/v1/rolls" });
await fastify.register(devSessionsRoutes, { prefix: "/api/v1/dev-sessions" });
await fastify.register(tanksRoutes, { prefix: "/api/v1/tanks" });

// Health check
fastify.get("/api/health", async () => ({ status: "ok" }));

// Start
try {
  await fastify.listen({ port: config.PORT, host: config.HOST });
  fastify.log.info(`Tomu API running on ${config.HOST}:${config.PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
