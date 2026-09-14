import { describe, expect, it, vi } from "vitest";
import { useFakeApi } from "./support/fake-api.js";

// api.ts reads its token once, at import.
vi.hoisted(() => {
  process.env.TOMU_API_TOKEN = "test-token";
});

const { api } = await import("../src/api.js");

describe("api()", () => {
  const fake = useFakeApi();

  it("authenticates every request with the bearer token", async () => {
    fake.answer("GET", "/cameras", { data: [] });
    await api("/cameras");
    expect(fake.request("GET", "/cameras").headers.Authorization).toBe("Bearer test-token");
  });

  it("declares a JSON body only when it sends one", async () => {
    fake.answer("POST", "/cameras", { data: {} });
    await api("/cameras", { method: "POST", body: JSON.stringify({ make: "Leica" }) });
    expect(fake.request("POST", "/cameras").headers["Content-Type"]).toBe("application/json");
  });

  // Fastify rejects a bodyless request that claims application/json with a 400.
  // That is how tomu_undo_load broke once.
  it("sends no Content-Type on a bodyless DELETE", async () => {
    fake.answer("DELETE", "/rolls/roll-1", null, 204);
    await api("/rolls/roll-1", { method: "DELETE" });
    expect(fake.request("DELETE", "/rolls/roll-1").headers).not.toHaveProperty("Content-Type");
  });

  it("returns undefined for 204 No Content", async () => {
    fake.answer("DELETE", "/rolls/roll-1", null, 204);
    await expect(api("/rolls/roll-1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("surfaces the server's error message with the status", async () => {
    fake.fail("POST", "/tanks/plan", 409, "No tanks on file");
    await expect(api("/tanks/plan", { method: "POST", body: "{}" })).rejects.toThrow("API error 409: No tanks on file");
  });
});
