import { afterEach, beforeEach, vi } from "vitest";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface SentRequest {
  method: Method;
  /** The path `api()` was called with: no host, no /api/v1, query string included. */
  path: string;
  headers: Record<string, string>;
  /** The parsed JSON body, or undefined when nothing was sent. */
  body: unknown;
}

interface Answer {
  status: number;
  body: unknown;
}

/**
 * A stand-in for the Tomu HTTP API, installed as the global `fetch`.
 *
 * The MCP server reaches Tomu only through HTTP, so this is the one seam a tool
 * test needs. Say what the API answers, call the tool, then check what it sent:
 *
 *   api.answer("GET", "/cameras", { data: [camera()] });
 *   await tomu.call("tomu_gear", { action: "add_camera", make: "Leica", model: "M6" });
 *   expect(api.sent("POST", "/cameras")).toEqual({ make: "Leica", model: "M6", format: "35mm" });
 *
 * Paths match exactly, query string and all. A request with no answer fails the
 * test and names the path, so a tool can never pass by quietly calling something
 * the test did not expect.
 */
export class FakeApi {
  readonly requests: SentRequest[] = [];
  private answers = new Map<string, Answer>();
  private unanswered: string[] = [];

  /** Answer `method path` with `{ data }`-style JSON (pass the whole body). */
  answer(method: Method, path: string, body: unknown, status = 200): this {
    this.answers.set(`${method} ${path}`, { status, body });
    return this;
  }

  /** Answer `method path` with an error status, the way Fastify reports one. */
  fail(method: Method, path: string, status: number, error: string): this {
    return this.answer(method, path, { error }, status);
  }

  /** The body of the most recent `method path` request. Throws if there was none. */
  sent(method: Method, path: string): unknown {
    const hit = [...this.requests].reverse().find((r) => r.method === method && r.path === path);
    if (!hit) {
      const seen = this.requests.map((r) => `  ${r.method} ${r.path}`).join("\n") || "  (nothing)";
      throw new Error(`Expected a ${method} ${path} request. Requests made:\n${seen}`);
    }
    return hit.body;
  }

  /** Whether any `method path` request was made — for asserting a write did not happen. */
  wasSent(method: Method, path: string): boolean {
    return this.requests.some((r) => r.method === method && r.path === path);
  }

  /** The request itself, when a test cares about headers. */
  request(method: Method, path: string): SentRequest {
    this.sent(method, path);
    return [...this.requests].reverse().find((r) => r.method === method && r.path === path)!;
  }

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^.*?\/api\/v1/, "") + url.search;
    const method = (init.method ?? "GET").toUpperCase() as Method;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    this.requests.push({ method, path, headers: { ...(init.headers as Record<string, string>) }, body });

    const answer = this.answers.get(`${method} ${path}`);
    if (!answer) {
      this.unanswered.push(`${method} ${path}`);
      throw new Error(`The fake API has no answer for ${method} ${path}. Add api.answer("${method}", "${path}", …).`);
    }
    if (answer.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  };

  reset(): void {
    this.requests.length = 0;
    this.answers.clear();
    this.unanswered = [];
  }

  assertAllAnswered(): void {
    if (this.unanswered.length) {
      throw new Error(`Requests with no answer: ${this.unanswered.join(", ")}`);
    }
  }
}

/** A fresh FakeApi installed as `fetch` for every test in the file. */
export function useFakeApi(): FakeApi {
  const api = new FakeApi();
  beforeEach(() => {
    api.reset();
    vi.stubGlobal("fetch", api.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    api.assertAllAnswered();
  });
  return api;
}
