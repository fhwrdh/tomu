/**
 * Runs before every test file, and crucially before anything imports
 * `src/config.ts` — which parses `process.env` once at import time.
 *
 * Server tests talk to a real Postgres (drizzle query building is most of what
 * the routes do, so mocking it would test the mock). Point them at a scratch
 * database, never the dev one.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://filmlog:filmlog@localhost:5432/filmlog_test";
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "development";
// Tier 2 stays off unless a test explicitly mocks the SDK and sets this.
delete process.env.ANTHROPIC_API_KEY;
