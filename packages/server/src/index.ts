import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { config } from "./config.js";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { camerasRoutes } from "./routes/cameras.js";
import { filmInventoryRoutes } from "./routes/film-inventory.js";
import { filmStocksRoutes } from "./routes/film-stocks.js";
import { lensesRoutes } from "./routes/lenses.js";
import { rollsRoutes } from "./routes/rolls.js";

const fastify = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
  },
});

// Plugins
await fastify.register(cors, { origin: config.CORS_ORIGIN });
await fastify.register(jwt, { secret: config.JWT_SECRET });
await fastify.register(authPlugin);

// Routes
await fastify.register(authRoutes, { prefix: "/api/v1/auth" });
await fastify.register(camerasRoutes, { prefix: "/api/v1/cameras" });
await fastify.register(lensesRoutes, { prefix: "/api/v1/lenses" });
await fastify.register(filmStocksRoutes, { prefix: "/api/v1/film-stocks" });
await fastify.register(filmInventoryRoutes, { prefix: "/api/v1/inventory" });
await fastify.register(rollsRoutes, { prefix: "/api/v1/rolls" });

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
