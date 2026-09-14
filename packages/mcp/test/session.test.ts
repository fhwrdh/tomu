import { describe, expect, it } from "vitest";
import { containsInitialize, routeSession } from "../src/session.js";

describe("routeSession", () => {
  it("uses a session the server still holds", () => {
    expect(routeSession({ sessionId: "abc", known: true, isInitialize: false })).toEqual({ kind: "existing" });
  });

  it("answers a forgotten session ID with 404, so the client re-initializes (the post-deploy case)", () => {
    const route = routeSession({ sessionId: "from-before-the-deploy", known: false, isInitialize: false });
    expect(route).toMatchObject({ kind: "reject", status: 404 });
  });

  it("answers a request with no session ID with 400", () => {
    expect(routeSession({ sessionId: undefined, known: false, isInitialize: false })).toMatchObject({
      kind: "reject",
      status: 400,
    });
  });

  it("opens a new session on initialize, with or without a stale ID attached", () => {
    expect(routeSession({ sessionId: undefined, known: false, isInitialize: true })).toEqual({ kind: "initialize" });
    expect(routeSession({ sessionId: "stale", known: false, isInitialize: true })).toEqual({ kind: "initialize" });
  });
});

describe("containsInitialize", () => {
  it("finds initialize in a single message or a batch", () => {
    expect(containsInitialize({ jsonrpc: "2.0", method: "initialize", id: 1 })).toBe(true);
    expect(containsInitialize([{ method: "tools/list" }, { method: "initialize" }])).toBe(true);
  });

  it("is false for other methods and for empty or missing bodies", () => {
    expect(containsInitialize({ method: "tools/call" })).toBe(false);
    expect(containsInitialize(undefined)).toBe(false);
    expect(containsInitialize(null)).toBe(false);
    expect(containsInitialize([])).toBe(false);
  });
});
