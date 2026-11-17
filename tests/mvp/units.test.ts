import { describe, expect, it } from "vitest";
import { costUsd } from "../../src/mvp/ai/models.js";
import { fakeSource } from "../../src/mvp/socialData/fake.js";

describe("AI cost", () => {
  it("prices Sonnet 5.5 with cache reads and writes", () => {
    const cost = costUsd("claude-sonnet-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    });
    expect(cost).toBeCloseTo(2 + 1 + 0.2, 6);
  });
  it("halves batch requests", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 0 };
    expect(costUsd("claude-opus-5-5", u, { batch: true })).toBeCloseTo(2, 6);
  });
});

describe("fake Social Data", () => {
  it("returns the same 12 posts for the same handle", async () => {
    const a = await fakeSource.lookupProfile("@BahiaTaste");
    const b = await fakeSource.lookupProfile("bahiataste");
    expect(a?.posts).toHaveLength(12);
    expect(a?.profile.followers).toBe(b?.profile.followers);
    expect(a?.posts.map((p) => p.likes)).toEqual(b?.posts.map((p) => p.likes));
  });
  it("answers null for a handle that doesn't exist", async () => {
    expect(await fakeSource.lookupProfile("notfound_xyz")).toBeNull();
  });
});
