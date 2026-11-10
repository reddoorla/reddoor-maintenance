import { describe, it, expect, vi, beforeEach } from "vitest";

const runPipelineEncode = vi.hoisted(() => vi.fn(async () => ({ output: "", code: 0 })));
vi.mock("../../src/video-pipeline/node/encode.js", () => ({ runPipelineEncode }));

import { runEncodeCommand } from "../../src/cli/commands/video-pipeline.js";

describe("cli: video-pipeline encode plumbing", () => {
  beforeEach(() => {
    runPipelineEncode.mockClear();
  });

  it("--force reaches runPipelineEncode as force: true, and a blank --key (cac's 0) passes through as no key", async () => {
    // The opts shape cac gives for: --url https://x.cdn.prismic.io/r/a.mp4 --class background --site s --key "" --force
    const opts = {
      url: "https://x.cdn.prismic.io/r/a.mp4",
      class: "background",
      site: "s",
      key: 0,
      force: true,
    } as unknown as Parameters<typeof runEncodeCommand>[0];
    await runEncodeCommand(opts);
    expect(runPipelineEncode).toHaveBeenCalledTimes(1);
    expect(runPipelineEncode).toHaveBeenCalledWith({
      url: "https://x.cdn.prismic.io/r/a.mp4",
      class: "background",
      site: "s",
      key: 0,
      force: true,
    });
  });

  it("without --force, runPipelineEncode receives force: false", async () => {
    await runEncodeCommand({
      url: "https://x.cdn.prismic.io/r/a.mp4",
      class: "background",
      site: "s",
    });
    expect(runPipelineEncode).toHaveBeenLastCalledWith(expect.objectContaining({ force: false }));
  });
});
