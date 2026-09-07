import { buildApp } from "./app.js";
import { config } from "./config.js";
import { sweepUnparsed, tier2Enabled } from "./services/field-parse-model.js";

const fastify = await buildApp({
  logger: { level: config.NODE_ENV === "production" ? "info" : "debug" },
});

try {
  await fastify.listen({ port: config.PORT, host: config.HOST });
  fastify.log.info(`Tomu API running on ${config.HOST}:${config.PORT}`);
  if (tier2Enabled()) {
    setInterval(() => { sweepUnparsed().catch((err) => fastify.log.warn({ err }, "tier-2 sweep failed")); }, 5 * 60_000).unref();
    fastify.log.info(`Tier-2 field parsing on (${config.FIELD_PARSE_MODEL})`);
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
