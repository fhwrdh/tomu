/**
 * Tier-2 tests. The Anthropic SDK is mocked — what matters here is the merge
 * policy and the failure bookkeeping around the call, not the model itself.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse };
  },
}));

// The service reads config.ANTHROPIC_API_KEY at import time to decide whether
// tier 2 exists at all, so the key has to be set before it is imported.
process.env.ANTHROPIC_API_KEY = "test-key";

const { db, pool } = await import("../src/db/client.js");
const { fieldEvents } = await import("../src/db/schema.js");
const { MAX_PARSE_ATTEMPTS, parseEventWithModel, sweepUnparsed, tier2Enabled } = await import(
  "../src/services/field-parse-model.js"
);
const { eq } = await import("drizzle-orm");
const { makeFixture, resetDb } = await import("./helpers/app.js");

let userId: string;

beforeEach(async () => {
  parse.mockReset();
  await resetDb();
  const f = await makeFixture();
  await f.app.close();
  userId = f.userId;
});

afterAll(async () => {
  await pool.end();
});

/** A tier-2 response shaped like the structured output the service asks for. */
function modelOutput(fields: Record<string, { value: string | null; confidence: number }>, extra = {}) {
  const blank = { value: null, confidence: 0 };
  return {
    parsed_output: {
      shutterSpeed: blank, aperture: blank, compensation: blank, meteringMode: blank,
      lensId: blank, subject: blank, locationName: blank,
      cameraId: null, remarks: null, sceneDescription: null, reviewReason: null,
      ...fields,
      ...extra,
    },
  };
}

async function insertEvent(values: Partial<typeof fieldEvents.$inferInsert> = {}) {
  const [row] = await db
    .insert(fieldEvents)
    .values({
      clientId: randomUUID(),
      userId,
      kind: "voice",
      transcript: "some words",
      ...values,
    })
    .returning();
  return row;
}

async function reload(id: string) {
  const [row] = await db.select().from(fieldEvents).where(eq(fieldEvents.id, id)).limit(1);
  return row;
}

describe("tier2Enabled", () => {
  it("is on when a key is configured", () => {
    expect(tier2Enabled()).toBe(true);
  });
});

describe("merge policy", () => {
  it("fills empty fields and stamps the parser", async () => {
    const ev = await insertEvent();
    parse.mockResolvedValue(modelOutput({
      shutterSpeed: { value: "1/250", confidence: 0.8 },
      subject: { value: "ferry deck", confidence: 0.7 },
    }));

    const res = await parseEventWithModel(ev.id);
    expect(res.skipped).toBe(false);
    expect(res.changed).toContain("shutterSpeed");

    const after = await reload(ev.id);
    expect(after.shutterSpeed).toBe("1/250");
    expect(after.subject).toBe("ferry deck");
    expect(after.parser).toMatch(/^claude:/);
    expect(after.parsedAt).not.toBeNull();
  });

  it("keeps a tier-1 value unless the model is at least 0.9 confident", async () => {
    const ev = await insertEvent({ aperture: "f/8", parser: "regex" });
    parse.mockResolvedValue(modelOutput({ aperture: { value: "f/11", confidence: 0.85 } }));

    await parseEventWithModel(ev.id);
    expect((await reload(ev.id)).aperture).toBe("f/8");

    parse.mockResolvedValue(modelOutput({ aperture: { value: "f/11", confidence: 0.95 } }));
    await parseEventWithModel(ev.id);
    expect((await reload(ev.id)).aperture).toBe("f/11");
  });

  it("never touches a hand-edited field, however confident the model is", async () => {
    const ev = await insertEvent({ aperture: "f/8", editedFields: ["aperture"] });
    parse.mockResolvedValue(modelOutput({ aperture: { value: "f/2", confidence: 1 } }));

    await parseEventWithModel(ev.id);
    expect((await reload(ev.id)).aperture).toBe("f/8");
  });

  it("never modifies the transcript", async () => {
    const ev = await insertEvent({ transcript: "the ramble, exactly as spoken" });
    parse.mockResolvedValue(modelOutput({ subject: { value: "x", confidence: 1 } }, {
      remarks: "tidied up", sceneDescription: "a scene",
    }));

    await parseEventWithModel(ev.id);
    expect((await reload(ev.id)).transcript).toBe("the ramble, exactly as spoken");
  });

  it("drops a lensId the user does not own", async () => {
    const ev = await insertEvent();
    parse.mockResolvedValue(modelOutput({ lensId: { value: randomUUID(), confidence: 1 } }));

    await parseEventWithModel(ev.id);
    expect((await reload(ev.id)).lensId).toBeNull();
  });

  it("sets review when the model gives a reason", async () => {
    const ev = await insertEvent();
    parse.mockResolvedValue(modelOutput({}, { reviewReason: "camera named has no active roll" }));

    await parseEventWithModel(ev.id);
    const after = await reload(ev.id);
    expect(after.review).toBe(true);
    expect(after.parseNotes).toBe("camera named has no active roll");
  });
});

describe("failures", () => {
  it("counts the attempt, records why, and leaves the event unparsed", async () => {
    const ev = await insertEvent();
    parse.mockRejectedValue(new Error("credit balance is too low"));

    await expect(parseEventWithModel(ev.id)).rejects.toThrow("credit balance");

    const after = await reload(ev.id);
    expect(after.parseAttempts).toBe(1);
    expect(after.parseNotes).toContain("tier-2 failed");
    expect(after.parser).toBeNull();
    // A failure is not a review request — the note is fine, the parse is not.
    expect(after.review).toBe(false);
  });

  it("resets the attempt count once a parse succeeds", async () => {
    const ev = await insertEvent({ parseAttempts: 3 });
    parse.mockResolvedValue(modelOutput({ subject: { value: "a barn", confidence: 1 } }));

    await parseEventWithModel(ev.id);
    expect((await reload(ev.id)).parseAttempts).toBe(0);
  });
});

describe("sweep", () => {
  it("picks up pending voice events that tier 2 has not seen", async () => {
    await insertEvent({ parser: "regex" });
    await insertEvent();
    parse.mockResolvedValue(modelOutput({ subject: { value: "x", confidence: 1 } }));

    expect(await sweepUnparsed()).toBe(2);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("ignores events tier 2 has already parsed, photos, and pinned events", async () => {
    await insertEvent({ parser: "claude:test" });
    await insertEvent({ kind: "photo", transcript: null });
    await insertEvent({ status: "pinned" });

    expect(await sweepUnparsed()).toBe(0);
    expect(parse).not.toHaveBeenCalled();
  });

  it("gives up on an event that has hit the attempt cap", async () => {
    await insertEvent({ parseAttempts: MAX_PARSE_ATTEMPTS });
    expect(await sweepUnparsed()).toBe(0);
  });

  it("keeps going when one event fails", async () => {
    await insertEvent({ transcript: "first" });
    await insertEvent({ transcript: "second" });
    parse
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(modelOutput({ subject: { value: "ok", confidence: 1 } }));

    expect(await sweepUnparsed()).toBe(2);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
