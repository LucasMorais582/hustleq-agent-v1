import { afterAll, describe, expect, it } from "vitest";
import { JOBS } from "../../src/mvp/jobs/index.js";
import * as jobs from "../../src/mvp/jobs/index.js";
import { enqueue, startQueue, stopQueue } from "../../src/mvp/jobs/queue.js";

afterAll(() => stopQueue());

describe("job queue", () => {
  it("runs a job end to end", async () => {
    await startQueue();
    await enqueue(JOBS.ping, { note: "test" });
    const deadline = Date.now() + 20_000;
    while (!jobs.lastPing && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    expect(jobs.lastPing?.data).toEqual({ note: "test" });
  });
});
