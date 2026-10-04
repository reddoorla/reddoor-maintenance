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

type FakeSource = { width: number; height: number; side_data_list?: { rotation?: number }[] };

function fakeSpawn(calls: Call[], source: FakeSource = { width: 1920, height: 1080 }): SpawnFn {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], opts });
    if (cmd === "ffprobe") {
      const entries = args[args.indexOf("-show_entries") + 1] ?? "";
      const json = entries.includes("format=size")
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
    expect(poster.args).toEqual(["-an", "-frames:v", "1", "-update", "1", "-q:v", "3"]);
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
      "-update",
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
      { spawn: fakeSpawn(calls), env: {}, stderr: { write: () => true } },
    );
    expect(res.code).toBe(0);

    expect(calls[0]!.cmd).toBe("ffprobe");
    expect(calls[0]!.args).toEqual([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration:stream_side_data=rotation:format=duration",
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
      { spawn: fakeSpawn(calls), env: {}, stderr: { write: () => true } },
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
      { spawn: fakeSpawn(calls), env: {}, stderr: { write: () => true } },
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
    expect(res.output).toContain("EXISTS master-360.webm asset-existing https://cdn/x.webm");
    expect(res.output).toContain(
      "UPLOADED master-poster.jpg asset-2 https://cdn/master-poster.jpg",
    );
  });

  it("exits 2 with an install hint when ffprobe is not on PATH", async () => {
    const spawn: SpawnFn = async (cmd) => {
      throw Object.assign(new Error(`spawn ${cmd} ENOENT`), {
        code: "ENOENT",
        syscall: `spawn ${cmd}`,
      });
    };
    const res = await runVideoCommand(
      "master.mp4",
      {},
      { spawn, env: {}, stderr: { write: () => true } },
    );
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
    const res = await runVideoCommand(
      "master.mp4",
      { cwd },
      { spawn, env: {}, stderr: { write: () => true } },
    );
    expect(res.code).toBe(1);
    expect(res.output).toContain("ffmpeg exited 187 while encoding master-1080.mp4");
  });
});

describe("video: review round 1", () => {
  it("a 1280x720 master rotated 90° plans from its upright 720x1280 dimensions", async () => {
    const plan = planRenditions(
      { width: 1280, height: 720, rotation: 90 },
      { name: "hero", maxHeight: 1080 },
    );
    expect(files(plan)).toEqual([
      "hero-1080.mp4",
      "hero-1080.webm",
      "hero-phone-720.mp4",
      "hero-poster.jpg",
    ]);
    const calls: Call[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const res = await runVideoCommand(
      "master.mp4",
      { cwd },
      {
        spawn: fakeSpawn(calls, { width: 1280, height: 720, side_data_list: [{ rotation: 90 }] }),
        env: {},
        stderr: { write: () => true },
      },
    );
    expect(res.code).toBe(0);
    expect(res.output).toContain("source master.mp4: 1280x720 rotated 90° (plays 720x1280) 12.5s");
    expect(calls.filter((c) => c.cmd === "ffmpeg")[0]!.args.at(-1)).toBe(
      join(cwd, "video-out", "master-1080.mp4"),
    );
  });

  it("--max-height 480 on a 1080 source produces no phone rendition", () => {
    const plan = planRenditions({ width: 1920, height: 1080 }, { name: "hero", maxHeight: 480 });
    expect(files(plan)).toEqual(["hero-480.mp4", "hero-480.webm", "hero-poster.jpg"]);
  });

  it("the poster row prints - for kbps and is probed without bit_rate", async () => {
    const calls: Call[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const res = await runVideoCommand(
      "Hero Loop.mov",
      { cwd, out: "out" },
      { spawn: fakeSpawn(calls), env: {}, stderr: { write: () => true } },
    );
    expect(res.code).toBe(0);
    expect(res.output).toMatch(/hero-loop-poster\.jpg\s+1280x720\s+2\.5\s+-\n?/);
    const posterProbe = calls.find(
      (c) => c.cmd === "ffprobe" && c.args.at(-1)!.endsWith("hero-loop-poster.jpg"),
    )!;
    expect(posterProbe.args).toContain("stream=width,height:format=size");
    expect(posterProbe.args.join(" ")).not.toContain("bit_rate");
  });

  it("the encoding label reaches stderr before that rendition's ffmpeg call", async () => {
    const events: string[] = [];
    const calls: Call[] = [];
    const base = fakeSpawn(calls);
    const spawn: SpawnFn = async (cmd, args, opts) => {
      if (cmd === "ffmpeg") events.push(`spawn ${args[args.length - 1]!.split("/").pop()}`);
      return base(cmd, args, opts);
    };
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const res = await runVideoCommand(
      "master.mp4",
      { cwd },
      { spawn, env: {}, stderr: { write: (s) => events.push(`label ${s.trim()}`) } },
    );
    expect(res.code).toBe(0);
    expect(events).toEqual([
      "label encoding master-1080.mp4",
      "spawn master-1080.mp4",
      "label encoding master-1080.webm",
      "spawn master-1080.webm",
      "label encoding master-phone-720.mp4",
      "spawn master-phone-720.mp4",
      "label encoding master-poster.jpg",
      "spawn master-poster.jpg",
    ]);
  });

  function uploadFixture(opts: {
    items?: { id: string; filename: string; url: string; size?: number }[];
    failOnPost?: number;
    readFile?: (path: string) => Promise<Uint8Array>;
  }) {
    const parts: { name: string; type: string }[] = [];
    let n = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ items: opts.items ?? [] }), { status: 200 });
      }
      const file = (init?.body as FormData).get("file") as File;
      parts.push({ name: file.name, type: file.type });
      n++;
      if (opts.failOnPost === n) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ id: `asset-${n}`, url: `https://cdn/${file.name}` }), {
        status: 200,
      });
    };
    const run = async () => {
      const calls: Call[] = [];
      const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
      return runVideoCommand(
        "master.mp4",
        { cwd, upload: "beach-front" },
        {
          spawn: fakeSpawn(calls, { width: 640, height: 360 }),
          env: { PRISMIC_TOKEN_BEACH_FRONT: "tok" },
          fetch: fetchImpl,
          readFile: opts.readFile ?? (async () => new Uint8Array([1, 2, 3])),
          sleep: async () => {},
          stderr: { write: () => true },
        },
      );
    };
    return { run, parts };
  }

  it("a failed second upload exits 1 keeping the first UPLOADED line and naming the failure", async () => {
    const { run } = uploadFixture({ failOnPost: 2 });
    const res = await run();
    expect(res.code).toBe(1);
    expect(res.output).toContain("UPLOADED master-360.mp4 asset-1 https://cdn/master-360.mp4");
    expect(res.output).toMatch(/FAILED master-360\.webm: .*500.*boom/);
    expect(res.output).not.toContain("master-poster.jpg asset");
  });

  it("a library file whose size differs from the local encode prints STALE and exits 1", async () => {
    const { run } = uploadFixture({
      items: [
        { id: "asset-old", filename: "master-360.webm", url: "https://cdn/x.webm", size: 999 },
      ],
    });
    const res = await run();
    expect(res.code).toBe(1);
    expect(res.output).toContain(
      "STALE master-360.webm asset-old https://cdn/x.webm (library 999 bytes, local 2621440 bytes)",
    );
    expect(res.output).not.toContain("UPLOADED");
    expect(res.output).toMatch(
      /1 library file\(s\) differ from the local encode; nothing uploaded/,
    );
  });

  it("a library file of the same name and size is EXISTS and the run exits 0", async () => {
    const { run } = uploadFixture({
      items: [
        { id: "asset-same", filename: "master-360.webm", url: "https://cdn/x.webm", size: 2621440 },
      ],
    });
    const res = await run();
    expect(res.code).toBe(0);
    expect(res.output).toContain("EXISTS master-360.webm asset-same https://cdn/x.webm");
    expect(res.output).not.toContain("size unverified");
  });

  it("each multipart part carries the MIME type of its extension", async () => {
    const { run, parts } = uploadFixture({});
    const res = await run();
    expect(res.code).toBe(0);
    expect(parts).toEqual([
      { name: "master-360.mp4", type: "video/mp4" },
      { name: "master-360.webm", type: "video/webm" },
      { name: "master-poster.jpg", type: "image/jpeg" },
    ]);
  });

  it("a missing output at upload time is a FAILED line, not an install hint", async () => {
    const { run } = uploadFixture({
      readFile: async (p) => {
        throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), {
          code: "ENOENT",
          syscall: "open",
        });
      },
    });
    const res = await run();
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/FAILED master-360\.mp4: ENOENT/);
    expect(res.output).not.toMatch(/install ffmpeg/);
  });

  it("an ENOENT that is not a spawn's is not read as a missing ffmpeg", async () => {
    const spawn: SpawnFn = async () => {
      throw Object.assign(new Error("ENOENT: no such file, open 'x'"), {
        code: "ENOENT",
        syscall: "open",
      });
    };
    await expect(
      runVideoCommand("master.mp4", {}, { spawn, env: {}, stderr: { write: () => true } }),
    ).rejects.toThrow(/ENOENT/);
  });
});

describe("video: review round 2", () => {
  it("a 401 on the asset list exits 1 keeping the source line and the table", async () => {
    const calls: Call[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const fetchImpl: typeof fetch = async () => new Response("bad token", { status: 401 });
    const res = await runVideoCommand(
      "master.mp4",
      { cwd, upload: "beach-front" },
      {
        spawn: fakeSpawn(calls, { width: 640, height: 360 }),
        env: { PRISMIC_TOKEN_BEACH_FRONT: "tok" },
        fetch: fetchImpl,
        sleep: async () => {},
        stderr: { write: () => true },
      },
    );
    expect(res.code).toBe(1);
    expect(res.output).toContain("source master.mp4: 640x360 12.5s");
    expect(res.output).toMatch(/master-360\.mp4\s+1280x720\s+2\.5\s+1800/);
    expect(res.output).toMatch(/FAILED asset list: asset list: 401 bad token/);
  });

  it("an EXISTS for a library item without size says so", async () => {
    const parts: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(
          JSON.stringify({
            items: [{ id: "asset-nosize", filename: "master-360.webm", url: "https://cdn/x.webm" }],
          }),
          { status: 200 },
        );
      }
      const file = (init?.body as FormData).get("file") as File;
      parts.push(file.name);
      return new Response(JSON.stringify({ id: "a", url: `https://cdn/${file.name}` }), {
        status: 200,
      });
    };
    const calls: Call[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const res = await runVideoCommand(
      "master.mp4",
      { cwd, upload: "beach-front" },
      {
        spawn: fakeSpawn(calls, { width: 640, height: 360 }),
        env: { PRISMIC_TOKEN_BEACH_FRONT: "tok" },
        fetch: fetchImpl,
        readFile: async () => new Uint8Array([1]),
        sleep: async () => {},
        stderr: { write: () => true },
      },
    );
    expect(res.code).toBe(0);
    expect(res.output).toContain(
      "EXISTS master-360.webm asset-nosize https://cdn/x.webm (size unverified)",
    );
    expect(parts).toEqual(["master-360.mp4", "master-poster.jpg"]);
  });

  it("--name given as a number names the outputs", async () => {
    const calls: Call[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "video-cmd-"));
    const res = await runVideoCommand(
      "master.mp4",
      { cwd, name: 101, out: 2024 },
      { spawn: fakeSpawn(calls), env: {}, stderr: { write: () => true } },
    );
    expect(res.code).toBe(0);
    expect(calls.filter((c) => c.cmd === "ffmpeg")[0]!.args.at(-1)).toBe(
      join(cwd, "2024", "101-1080.mp4"),
    );
  });

  it("a rotation of 89 is planned as a quarter turn, 180 is not", () => {
    const opts = { name: "hero", maxHeight: 1080 };
    expect(files(planRenditions({ width: 1280, height: 720, rotation: 89 }, opts))[0]).toBe(
      "hero-1080.mp4",
    );
    expect(files(planRenditions({ width: 1280, height: 720, rotation: -180 }, opts))[0]).toBe(
      "hero-720.mp4",
    );
  });

  it("a missing input exits 2 naming the file, before any ffmpeg", async () => {
    const calls: Call[] = [];
    const spawn: SpawnFn = async (cmd, args, opts) => {
      calls.push({ cmd, args: [...args], opts });
      return { code: 1, stdout: "", stderr: `${args.at(-1)}: No such file or directory` };
    };
    await expect(
      runVideoCommand("gone.mp4", {}, { spawn, env: {}, stderr: { write: () => true } }),
    ).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/gone\.mp4: no such file/),
    });
    expect(calls.filter((c) => c.cmd === "ffmpeg")).toHaveLength(0);
  });
});
