import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnFn, SpawnOptions } from "../../src/audits/util/spawn.js";
import {
  ffmpegArgv,
  formatTable,
  planRenditions,
  runVideoCommand,
  slugify,
} from "../../src/cli/commands/video.js";

type Call = { cmd: string; args: string[]; opts: SpawnOptions | undefined };

function fakeSpawn(calls: Call[], source = { width: 1920, height: 1080 }): SpawnFn {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], opts });
    if (cmd === "ffprobe") {
      const entries = args[args.indexOf("-show_entries") + 1] ?? "";
      const json = entries.includes("format=")
        ? {
            streams: [{ width: 1280, height: 720 }],
            format: { size: "2621440", bit_rate: "1800000" },
          }
        : { streams: [{ ...source, duration: "12.500000" }] };
      return { code: 0, stdout: JSON.stringify(json), stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
}

const files = (plan: { file: string }[]) => plan.map((r) => r.file);

describe("video: slugify", () => {
  it("lowercases and collapses non-alphanumeric runs to one dash", () => {
    expect(slugify("Hero Loop_FINAL v2.mov")).toBe("hero-loop-final-v2-mov");
    expect(slugify("  --Already-slug--  ")).toBe("already-slug");
    expect(slugify("ÄÖ")).toBe("");
  });
});

describe("video: planRenditions", () => {
  it("1920x1080 source: 1080 mp4, 1080 webm, phone 720, poster", () => {
    const plan = planRenditions({ width: 1920, height: 1080 }, { name: "hero", maxHeight: 1080 });
    expect(files(plan)).toEqual([
      "hero-1080.mp4",
      "hero-1080.webm",
      "hero-phone-720.mp4",
      "hero-poster.jpg",
    ]);
    expect(plan[0]!.args).toContain("scale=-2:1080:flags=lanczos,format=yuv420p");
    expect(plan[2]!.args).toContain("scale=-2:720:flags=lanczos,format=yuv420p");
  });

  it("1280x720 source: main renditions at 720 and the phone rendition still produced", () => {
    const plan = planRenditions({ width: 1280, height: 720 }, { name: "hero", maxHeight: 1080 });
    expect(files(plan)).toEqual([
      "hero-720.mp4",
      "hero-720.webm",
      "hero-phone-720.mp4",
      "hero-poster.jpg",
    ]);
  });

  it("640x360 source: T=360 and no phone rendition", () => {
    const plan = planRenditions({ width: 640, height: 360 }, { name: "hero", maxHeight: 1080 });
    expect(files(plan)).toEqual(["hero-360.mp4", "hero-360.webm", "hero-poster.jpg"]);
    expect(files(plan).some((f) => f.includes("phone"))).toBe(false);
  });

  it("maxHeight 720 caps a 1080 source at 720", () => {
    const plan = planRenditions({ width: 1920, height: 1080 }, { name: "hero", maxHeight: 720 });
    expect(files(plan)).toEqual([
      "hero-720.mp4",
      "hero-720.webm",
      "hero-phone-720.mp4",
      "hero-poster.jpg",
    ]);
    expect(plan[0]!.args).toContain("scale=-2:720:flags=lanczos,format=yuv420p");
  });

  it("rounds an odd target height down to even", () => {
    const plan = planRenditions({ width: 1000, height: 719 }, { name: "x", maxHeight: 1080 });
    expect(plan[0]!.file).toBe("x-718.mp4");
  });

  it("the mp4 renditions carry faststart", () => {
    const plan = planRenditions({ width: 1920, height: 1080 }, { name: "hero", maxHeight: 1080 });
    const main = plan[0]!.args;
    expect(main[main.indexOf("-movflags") + 1]).toBe("+faststart");
    const phone = plan[2]!.args;
    expect(phone[phone.indexOf("-movflags") + 1]).toBe("+faststart");
  });

  it("every rendition drops audio with -an and never sets -c:a", () => {
    const plan = planRenditions({ width: 1920, height: 1080 }, { name: "hero", maxHeight: 1080 });
    for (const r of plan) {
      expect(r.args).toContain("-an");
      expect(r.args).not.toContain("-c:a");
    }
  });

  it("the poster is taken from the main mp4, not the master", () => {
    const plan = planRenditions({ width: 1920, height: 1080 }, { name: "hero", maxHeight: 1080 });
    const poster = plan[plan.length - 1]!;
    expect(poster.from).toBe("hero-1080.mp4");
    expect(poster.args).toEqual(["-an", "-frames:v", "1", "-q:v", "3"]);
    expect(ffmpegArgv("/in/master.mov", poster, "/out")).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-stats",
      "-y",
      "-i",
      "/out/hero-1080.mp4",
      "-an",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "/out/hero-poster.jpg",
    ]);
  });
});

describe("video: formatTable", () => {
  it("prints file, WxH, MB to one decimal and kbps", () => {
    const out = formatTable([
      { file: "a-1080.mp4", width: 1920, height: 1080, sizeBytes: 2621440, bitRate: 1800000 },
      { file: "a-poster.jpg", width: 1920, height: 1080, sizeBytes: 102400, bitRate: null },
    ]);
    const rows = out.split("\n");
    expect(rows[0]).toMatch(/^file\s+WxH\s+MB\s+kbps$/);
    expect(rows[1]).toMatch(/^a-1080\.mp4\s+1920x1080\s+2\.5\s+1800$/);
    expect(rows[2]).toMatch(/^a-poster\.jpg\s+1920x1080\s+0\.1\s+-$/);
  });
});

describe("video: runVideoCommand", () => {
  it("probes the master, runs ffmpeg per rendition in order, streams, and prints the table", async () => {
    const calls: Call[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const res = await runVideoCommand(
      "Hero Loop.mov",
      { cwd, out: "out" },
      { spawn: fakeSpawn(calls), env: {} },
    );
    expect(res.code).toBe(0);

    expect(calls[0]!.cmd).toBe("ffprobe");
    expect(calls[0]!.args).toEqual([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration",
      "-of",
      "json",
      join(cwd, "Hero Loop.mov"),
    ]);

    const ffmpeg = calls.filter((c) => c.cmd === "ffmpeg");
    expect(ffmpeg.map((c) => c.args[c.args.length - 1])).toEqual([
      join(cwd, "out", "hero-loop-1080.mp4"),
      join(cwd, "out", "hero-loop-1080.webm"),
      join(cwd, "out", "hero-loop-phone-720.mp4"),
      join(cwd, "out", "hero-loop-poster.jpg"),
    ]);
    for (const c of ffmpeg) expect(c.opts?.streaming).toBe(true);

    expect(ffmpeg[0]!.args).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-stats",
      "-y",
      "-i",
      join(cwd, "Hero Loop.mov"),
      "-an",
      "-vf",
      "scale=-2:1080:flags=lanczos,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "23",
      "-maxrate",
      "5M",
      "-bufsize",
      "10M",
      "-profile:v",
      "high",
      "-movflags",
      "+faststart",
      join(cwd, "out", "hero-loop-1080.mp4"),
    ]);
    for (const c of ffmpeg) {
      expect(c.args).toContain("-an");
      expect(c.args).not.toContain("-c:a");
    }
    expect(ffmpeg[3]!.args[ffmpeg[3]!.args.indexOf("-i") + 1]).toBe(
      join(cwd, "out", "hero-loop-1080.mp4"),
    );

    const probes = calls.filter((c) => c.cmd === "ffprobe");
    expect(probes).toHaveLength(5);
    expect(probes[1]!.args).toContain("stream=width,height:format=size,bit_rate");

    expect(res.output).toContain("source Hero Loop.mov: 1920x1080 12.5s");
    expect(res.output).toMatch(/hero-loop-1080\.mp4\s+1280x720\s+2\.5\s+1800/);
    expect(res.output).not.toContain("UPLOADED");
  });

  it("honours --name and --max-height", async () => {
    const calls: Call[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const res = await runVideoCommand(
      "master.mp4",
      { cwd, name: "Front Door", maxHeight: "720" },
      { spawn: fakeSpawn(calls), env: {} },
    );
    expect(res.code).toBe(0);
    const outputs = calls.filter((c) => c.cmd === "ffmpeg").map((c) => c.args[c.args.length - 1]);
    expect(outputs[0]).toBe(join(cwd, "video-out", "front-door-720.mp4"));
  });

  it("rejects a non-numeric --max-height with exit code 2", async () => {
    const calls: Call[] = [];
    const res = await runVideoCommand(
      "master.mp4",
      { maxHeight: "tall" },
      { spawn: fakeSpawn(calls), env: {} },
    );
    expect(res.code).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it("--upload with no token exits 2 naming the env var, before any encoding", async () => {
    const calls: Call[] = [];
    const res = await runVideoCommand(
      "master.mp4",
      { upload: "beach-front" },
      { spawn: fakeSpawn(calls), env: { PRISMIC_WRITE_TOKEN: "generic-must-not-count" } },
    );
    expect(res.code).toBe(2);
    expect(res.output).toContain("PRISMIC_TOKEN_BEACH_FRONT");
    expect(calls).toHaveLength(0);
  });

  it("--upload dedupes by filename and prints UPLOADED / EXISTS lines", async () => {
    const calls: Call[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const requests: { url: string; method: string; headers: Record<string, string> }[] = [];
    let n = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      requests.push({ url: u, method, headers: (init?.headers ?? {}) as Record<string, string> });
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            items: [
              { id: "asset-existing", filename: "master-360.webm", url: "https://cdn/x.webm" },
            ],
          }),
          { status: 200 },
        );
      }
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      n++;
      return new Response(JSON.stringify({ id: `asset-${n}`, url: `https://cdn/${file.name}` }), {
        status: 200,
      });
    };
    const res = await runVideoCommand(
      "master.mp4",
      { cwd, upload: "beach-front" },
      {
        spawn: fakeSpawn(calls, { width: 640, height: 360 }),
        env: { PRISMIC_TOKEN_BEACH_FRONT: "tok" },
        fetch: fetchImpl,
        readFile: async () => new Uint8Array([1, 2, 3]),
        sleep: async () => {},
      },
    );
    expect(res.code).toBe(0);
    expect(requests[0]).toMatchObject({
      url: "https://asset-api.prismic.io/assets?limit=500",
      method: "GET",
      headers: { repository: "beach-front", Authorization: "Bearer tok" },
    });
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(2);
    expect(res.output).toContain("UPLOADED master-360.mp4 asset-1 https://cdn/master-360.mp4");
    expect(res.output).toContain("EXISTS master-360.webm asset-existing");
    expect(res.output).toContain(
      "UPLOADED master-poster.jpg asset-2 https://cdn/master-poster.jpg",
    );
  });

  it("exits 2 with an install hint when ffprobe is not on PATH", async () => {
    const spawn: SpawnFn = async (cmd) => {
      throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
    };
    const res = await runVideoCommand("master.mp4", {}, { spawn, env: {} });
    expect(res.code).toBe(2);
    expect(res.output).toMatch(/install ffmpeg/);
  });

  it("exits 1 when ffmpeg fails on a rendition", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const calls: Call[] = [];
    const base = fakeSpawn(calls);
    const spawn: SpawnFn = async (cmd, args, opts) => {
      if (cmd === "ffmpeg") return { code: 187, stdout: "", stderr: "" };
      return base(cmd, args, opts);
    };
    const res = await runVideoCommand("master.mp4", { cwd }, { spawn, env: {} });
    expect(res.code).toBe(1);
    expect(res.output).toContain("ffmpeg exited 187 while encoding master-1080.mp4");
  });
});
