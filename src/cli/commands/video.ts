import { mkdir, readFile as fsReadFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { defaultSpawn } from "../../audits/util/spawn.js";
import type { SpawnFn } from "../../audits/util/spawn.js";
import { listAssetsByFilename, uploadAsset } from "../../prismic/asset-api.js";
import type { FetchFn, LibraryAsset } from "../../prismic/asset-api.js";
import { prismicTokenEnvName, resolvePrismicToken } from "../../prismic/models/token.js";

export type VideoCommandOptions = {
  out?: string | number;
  name?: string | number;
  maxHeight?: string | number;
  upload?: string | number;
  cwd?: string;
};

export type VideoCommandDeps = {
  spawn?: SpawnFn;
  fetch?: FetchFn;
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => Promise<Uint8Array>;
  sleep?: (ms: number) => Promise<void>;
  stderr?: { write: (chunk: string) => unknown };
};

export type Rendition = { file: string; from: string | null; args: string[] };

export type ProbedOutput = {
  file: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  bitRate: number | null;
};

export const DEFAULT_MAX_HEIGHT = 1080;
export const DEFAULT_OUT_DIR = "./video-out";
const UPLOAD_THROTTLE_MS = 1200;
const INSTALL_HINT =
  "ffmpeg and ffprobe must be on PATH (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg).";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const scaleFilter = (height: number): string => `scale=-2:${height}:flags=lanczos,format=yuv420p`;

export function planRenditions(
  source: { width: number; height: number; rotation?: number },
  opts: { name: string; maxHeight: number },
): Rendition[] {
  const upright = isQuarterTurn(source.rotation)
    ? { width: source.height, height: source.width }
    : { width: source.width, height: source.height };
  let target = Math.min(opts.maxHeight, upright.height);
  if (target % 2 !== 0) target -= 1;
  const main = `${opts.name}-${target}.mp4`;
  const renditions: Rendition[] = [
    {
      file: main,
      from: null,
      args: [
        "-an",
        "-vf",
        scaleFilter(target),
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
      ],
    },
    {
      file: `${opts.name}-${target}.webm`,
      from: null,
      args: [
        "-an",
        "-vf",
        scaleFilter(target),
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "34",
        "-b:v",
        "3500k",
        "-row-mt",
        "1",
        "-deadline",
        "good",
        "-cpu-used",
        "2",
      ],
    },
  ];
  if (upright.height >= 720 && target >= 720) {
    renditions.push({
      file: `${opts.name}-phone-720.mp4`,
      from: null,
      args: [
        "-an",
        "-vf",
        scaleFilter(720),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "24",
        "-maxrate",
        "1200k",
        "-bufsize",
        "2400k",
        "-profile:v",
        "main",
        "-movflags",
        "+faststart",
      ],
    });
  }
  renditions.push({
    file: `${opts.name}-poster.jpg`,
    from: main,
    args: ["-an", "-frames:v", "1", "-update", "1", "-q:v", "3"],
  });
  return renditions;
}

export function isQuarterTurn(rotation: number | undefined): boolean {
  if (rotation === undefined) return false;
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  return Math.abs(r - 90) <= 1 || Math.abs(r - 270) <= 1;
}

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
};

export function ffmpegArgv(input: string, rendition: Rendition, outDir: string): string[] {
  const from = rendition.from === null ? input : join(outDir, rendition.from);
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-stats",
    "-y",
    "-i",
    from,
    ...rendition.args,
    join(outDir, rendition.file),
  ];
}

export function formatTable(rows: readonly ProbedOutput[]): string {
  const cells = rows.map((r) => [
    r.file,
    r.width !== null && r.height !== null ? `${r.width}x${r.height}` : "-",
    r.sizeBytes !== null ? (r.sizeBytes / (1024 * 1024)).toFixed(1) : "-",
    r.bitRate !== null ? String(Math.round(r.bitRate / 1000)) : "-",
  ]);
  const header = ["file", "WxH", "MB", "kbps"];
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));
  const line = (c: string[]) =>
    c.map((v, i) => (i === 0 ? v.padEnd(widths[i]!) : v.padStart(widths[i]!))).join("  ");
  return [line(header), ...cells.map(line)].join("\n");
}

function parseMaxHeight(value: string | number | undefined): number | null {
  if (value === undefined) return DEFAULT_MAX_HEIGHT;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 2) return null;
  return n;
}

function isEnoent(err: unknown): boolean {
  const e = err as { code?: string; syscall?: string } | null;
  return e?.code === "ENOENT" && typeof e.syscall === "string" && e.syscall.startsWith("spawn");
}

type ProbeJson = {
  streams?: {
    width?: number;
    height?: number;
    duration?: string;
    side_data_list?: { rotation?: number }[];
  }[];
  format?: { size?: string; bit_rate?: string; duration?: string };
};

const numberOrNull = (v: string | number | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function probe(spawn: SpawnFn, entries: string, file: string): Promise<ProbeJson> {
  const res = await spawn("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    entries,
    "-of",
    "json",
    file,
  ]);
  if (res.code !== 0) {
    if (/No such file or directory/.test(res.stderr)) {
      throw Object.assign(new Error(`${file}: no such file`), { exitCode: 2 });
    }
    throw Object.assign(new Error(`ffprobe exited ${res.code} for ${file}: ${res.stderr.trim()}`), {
      exitCode: 1,
    });
  }
  return JSON.parse(res.stdout) as ProbeJson;
}

export async function runVideoCommand(
  input: string,
  opts: VideoCommandOptions,
  deps: VideoCommandDeps = {},
): Promise<{ output: string; code: number }> {
  const spawn = deps.spawn ?? defaultSpawn;
  const env = deps.env ?? process.env;
  const readFile = deps.readFile ?? ((p: string) => fsReadFile(p));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stderr = deps.stderr ?? process.stderr;

  const maxHeight = parseMaxHeight(opts.maxHeight);
  if (maxHeight === null) {
    return {
      output: `--max-height must be a whole number of pixels (at least 2); got ${JSON.stringify(opts.maxHeight)}`,
      code: 2,
    };
  }

  const repo = opts.upload !== undefined ? String(opts.upload).trim() : undefined;
  let token: string | null = null;
  if (repo) {
    const resolved = resolvePrismicToken(repo, env, { allowGeneric: false });
    if (resolved === null) {
      return {
        output: `--upload ${repo}: no write token in the environment; set ${prismicTokenEnvName(repo)}`,
        code: 2,
      };
    }
    token = resolved.token;
  }

  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const inputPath = resolve(cwd, input);
  const outDir = resolve(cwd, opts.out !== undefined ? String(opts.out) : DEFAULT_OUT_DIR);
  const name = slugify(String(opts.name ?? basename(input, extname(input))));
  if (name === "") {
    return {
      output: `--name slugifies to nothing; got ${JSON.stringify(opts.name ?? basename(input))}`,
      code: 2,
    };
  }

  const lines: string[] = [];
  const fail = (label: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`FAILED ${label}: ${message}`);
    return { output: lines.join("\n"), code: 1 };
  };
  try {
    const src = await probe(
      spawn,
      "stream=width,height,duration:stream_side_data=rotation:format=duration",
      inputPath,
    );
    const stream = src.streams?.[0];
    const width = numberOrNull(stream?.width);
    const height = numberOrNull(stream?.height);
    if (width === null || height === null) {
      return { output: `${input}: ffprobe found no video stream`, code: 2 };
    }
    const duration = numberOrNull(stream?.duration ?? src.format?.duration);
    const rotation = stream?.side_data_list?.find((s) => typeof s.rotation === "number")?.rotation;
    const turned = isQuarterTurn(rotation);
    lines.push(
      `source ${input}: ${width}x${height}${turned ? ` rotated ${rotation}° (plays ${height}x${width})` : ""}${duration !== null ? ` ${duration.toFixed(1)}s` : ""}`,
    );

    const plan = planRenditions(
      { width, height, ...(rotation !== undefined ? { rotation } : {}) },
      { name, maxHeight },
    );
    await mkdir(outDir, { recursive: true });
    for (const r of plan) {
      stderr.write(`encoding ${r.file}\n`);
      const res = await spawn("ffmpeg", ffmpegArgv(inputPath, r, outDir), { streaming: true });
      if (res.code !== 0) {
        return {
          output: [...lines, `ffmpeg exited ${res.code} while encoding ${r.file}`].join("\n"),
          code: 1,
        };
      }
    }

    const probed: ProbedOutput[] = [];
    try {
      for (const r of plan) {
        const isPoster = r.file.endsWith(".jpg");
        const info = await probe(
          spawn,
          isPoster ? "stream=width,height:format=size" : "stream=width,height:format=size,bit_rate",
          join(outDir, r.file),
        );
        probed.push({
          file: r.file,
          width: numberOrNull(info.streams?.[0]?.width),
          height: numberOrNull(info.streams?.[0]?.height),
          sizeBytes: numberOrNull(info.format?.size),
          bitRate: isPoster ? null : numberOrNull(info.format?.bit_rate),
        });
      }
    } catch (err) {
      if (isEnoent(err)) throw err;
      return fail("probe", err);
    }
    lines.push("", formatTable(probed), "");

    if (repo && token !== null) {
      let existing: Map<string, LibraryAsset>;
      try {
        existing = await listAssetsByFilename(repo, token, deps.fetch ?? fetch);
      } catch (err) {
        return fail("asset list", err);
      }
      let stale = 0;
      const pending: Rendition[] = [];
      for (const r of plan) {
        const known = existing.get(r.file);
        if (!known) {
          pending.push(r);
          continue;
        }
        const localSize = probed.find((p) => p.file === r.file)?.sizeBytes ?? null;
        if (known.size === undefined) {
          lines.push(`EXISTS ${r.file} ${known.id} ${known.url} (size unverified)`);
        } else if (localSize !== null && known.size !== localSize) {
          stale++;
          lines.push(
            `STALE ${r.file} ${known.id} ${known.url} (library ${known.size} bytes, local ${localSize} bytes)`,
          );
        } else {
          lines.push(`EXISTS ${r.file} ${known.id} ${known.url}`);
        }
      }
      if (stale > 0) {
        lines.push(
          `${stale} library file(s) differ from the local encode; nothing uploaded. Re-run with a new --name or delete them in Prismic first`,
        );
        return { output: lines.join("\n"), code: 1 };
      }
      for (const r of pending) {
        await sleep(UPLOAD_THROTTLE_MS);
        try {
          const bytes = await readFile(join(outDir, r.file));
          const type = MIME_BY_EXT[extname(r.file)];
          const blob = new Blob(
            [new Uint8Array(bytes).buffer as ArrayBuffer],
            type ? { type } : {},
          );
          const created = await uploadAsset(repo, token, r.file, blob, {
            ...(deps.fetch ? { fetchImpl: deps.fetch } : {}),
          });
          lines.push(`UPLOADED ${r.file} ${created.id} ${created.url}`);
        } catch (err) {
          return fail(r.file, err);
        }
      }
    }
  } catch (err) {
    if (isEnoent(err)) {
      return { output: [...lines, INSTALL_HINT].join("\n"), code: 2 };
    }
    throw err;
  }

  return { output: lines.join("\n"), code: 0 };
}
