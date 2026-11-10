import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { defaultSpawn } from "../../audits/util/spawn.js";
import type { SpawnFn } from "../../audits/util/spawn.js";
import { runVideoCommand } from "../../cli/commands/video.js";
import {
  fileNameOf,
  isPrismicFileUrl,
  keyStem,
  SITE_NAME,
  sourceOf,
  videoKey,
  VIDEO_EXT,
} from "../key.js";
import type { VideoClass } from "../key.js";
import { parseManifest } from "../manifest.js";
import type { ManifestFiles, VideoManifest } from "../manifest.js";
import { transcribe } from "./captions.js";
import { getObject, putObject } from "./s3.js";
import type { S3Config } from "./s3.js";

function parseUrl(raw: string | undefined): URL | null {
  if (raw === undefined) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export type EncodeDeps = {
  fetch?: typeof fetch;
  spawn?: SpawnFn;
  env?: Record<string, string | undefined>;
  stderr?: { write(s: string): unknown };
  now?: () => Date;
  tmpDir?: string;
};

const MAX_MASTER_BYTES = 120 * 1024 * 1024;
/** The version directory's stamp: 2026-11-10T00:00:00.500Z becomes 20261110T000000Z-500 (second, then milliseconds). */
const versionStamp = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.(\d{3})Z$/, "Z-$1");
const IMMUTABLE = "public, max-age=31536000, immutable";
const MANIFEST_CACHE = "public, max-age=60";
const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".vtt": "text/vtt",
};

class StepError extends Error {
  constructor(
    readonly label: string,
    message: string,
  ) {
    super(`FAILED ${label}: ${message}`);
  }
}

/** The master download: a redirect is an error (the URL must be the Prismic file itself) and a stalled one gives up after 10 minutes. */
const MASTER_TIMEOUT_MS = 10 * 60_000;

async function downloadTo(url: string, dest: string, fetchImpl: typeof fetch): Promise<number> {
  const res = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(MASTER_TIMEOUT_MS),
  });
  if (!res.ok) throw new StepError("download", `${url} returned HTTP ${res.status}`);
  if (res.body === null) throw new StepError("download", "empty response body");
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_MASTER_BYTES) {
    throw new StepError("download", `larger than ${MAX_MASTER_BYTES} bytes`);
  }
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > MAX_MASTER_BYTES) {
        cb(new StepError("download", `larger than ${MAX_MASTER_BYTES} bytes`));
        return;
      }
      cb(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    counter,
    createWriteStream(dest),
  );
  return bytes;
}

/** Validates, downloads the Prismic master, encodes it with the video command, captions player videos, uploads to R2, writes the manifest last. */
export async function runPipelineEncode(
  opts: {
    url?: string | undefined;
    class?: string | undefined;
    site?: string | undefined;
    key?: string | undefined;
    /** Re-encode even when the R2 manifest already holds this class. */
    force?: boolean | undefined;
  },
  deps: EncodeDeps = {},
): Promise<{ output: string; code: number }> {
  const env = deps.env ?? process.env;
  const spawn = deps.spawn ?? defaultSpawn;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  const fail = (output: string, code = 2) => ({ output, code });

  // cac passes numeric flag values as numbers, so every option is coerced to a string first.
  const url = parseUrl(opts.url == null ? undefined : String(opts.url));
  if (url === null || !isPrismicFileUrl(url.toString())) {
    return fail("--url must be an https Prismic file URL");
  }
  const cls = opts.class == null ? undefined : String(opts.class);
  if (cls !== "background" && cls !== "player") {
    return fail(`--class must be background or player; got ${JSON.stringify(opts.class)}`);
  }
  const profile: VideoClass = cls;
  const site = opts.site == null ? "" : String(opts.site);
  if (!SITE_NAME.test(site)) {
    return fail(
      `--site must be a site name (a lowercase letter, then letters, digits or hyphens); got ${JSON.stringify(site)}`,
    );
  }
  const key = videoKey(site, url.toString());
  if (key === null) {
    return fail(`--url must be a video file (${VIDEO_EXT.source}) whose name slugifies to a key`);
  }
  // The workflow dispatches a key it computed; an encode that would write under a different key is refused.
  // A blank key (cac turns `--key ""` into 0, and a manual run leaves it out) means no key was given.
  const givenKey = opts.key == null ? "" : String(opts.key);
  const noKeyGiven = givenKey === "" || givenKey === "0";
  if (!noKeyGiven && givenKey !== key) {
    return fail(`--key ${givenKey} does not match ${key} for --site ${site}`);
  }
  const sourcePath = sourceOf(url.toString());
  if (sourcePath === null) return fail("--url must be an https Prismic file URL");

  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  if (profile === "player") required.push("CF_AI_TOKEN");
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    return fail(`missing environment variables: ${missing.join(", ")}`);
  }
  const accountId = env.R2_ACCOUNT_ID!;
  const cfg: S3Config = {
    endpoint: env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET || "reddoor-video",
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
  };
  const cfAccount = env.CF_ACCOUNT_ID || accountId;

  // A player manifest is never downgraded: a background run over an existing player skips, before any download.
  const manifestKey = `${key}/manifest.json`;
  let existing: VideoManifest | null = null;
  try {
    const bytes = await getObject(cfg, manifestKey, { fetch: fetchImpl, now: now() });
    if (bytes !== null) {
      try {
        existing = parseManifest(JSON.parse(new TextDecoder().decode(bytes)));
      } catch {
        existing = null;
      }
    }
  } catch (err) {
    return fail(`FAILED manifest: ${err instanceof Error ? err.message : String(err)}`, 1);
  }
  if (existing !== null && existing.class === "player" && profile === "background") {
    return { output: `SKIP ${key}: already encoded as player (${existing.dir})`, code: 0 };
  }
  // A re-publish during an encode re-dispatches the same class; only --force re-encodes what R2 already serves.
  if (existing !== null && existing.class === profile && opts.force !== true) {
    return {
      output: `SKIP ${key}: already encoded as ${profile} (${existing.dir}); --force re-encodes`,
      code: 0,
    };
  }

  const tmp = await mkdtemp(join(deps.tmpDir ?? tmpdir(), "video-encode-"));
  const lines: string[] = [];
  try {
    const stem = keyStem(key);
    // videoKey guarantees the name ends in VIDEO_EXT, so the extension is kept.
    const ext = extname(fileNameOf(url.toString()) ?? "").toLowerCase();
    const master = join(tmp, `master${ext}`);
    const bytes = await downloadTo(url.toString(), master, fetchImpl);
    lines.push(`downloaded ${bytes} bytes`);

    const out = join(tmp, "out");
    const encoded = await runVideoCommand(
      master,
      { out, name: stem, profile },
      { spawn, ...(deps.stderr ? { stderr: deps.stderr } : {}) },
    );
    if (encoded.code !== 0) {
      return { output: [...lines, encoded.output].join("\n"), code: encoded.code };
    }
    lines.push(encoded.output);

    const names = new Set(await readdir(out));
    const numeric = [...names]
      .map((n) => ({ n, m: new RegExp(`^${stem}-(\\d+)\\.mp4$`).exec(n) }))
      .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
      .sort((a, b) => Number(b.m[1]) - Number(a.m[1]));
    const mainMp4 = numeric[0]?.n;
    if (mainMp4 === undefined) throw new StepError("encode", "no main mp4 was written");
    const files: ManifestFiles = { mp4: mainMp4, poster: `${stem}-poster.jpg` };
    if (profile === "player") {
      if (numeric.length > 1) files.mobileMp4 = `${stem}-720.mp4`;
    } else {
      const webm = [...names].find((n) => new RegExp(`^${stem}-\\d+\\.webm$`).test(n));
      if (webm) files.webm = webm;
      if (names.has(`${stem}-phone-720.mp4`)) files.mobileMp4 = `${stem}-phone-720.mp4`;
    }
    if (!names.has(files.poster)) throw new StepError("encode", `${files.poster} was not written`);

    // Captions are optional: a failure in any step below is a WARN line, and the video still ships.
    if (profile === "player") {
      try {
        const probe = await spawn("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "a",
          "-show_entries",
          "stream=index",
          "-of",
          "csv=p=0",
          master,
        ]);
        if (probe.code !== 0) throw new StepError("audio probe", probe.stderr.trim());
        if (probe.stdout.trim() === "") {
          lines.push("no audio stream; no captions");
        } else {
          const audio = join(tmp, "audio.mp3");
          const extract = await spawn("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            master,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "32k",
            audio,
          ]);
          if (extract.code !== 0) throw new StepError("audio extract", extract.stderr.trim());
          const vtt = await transcribe(new Uint8Array(await readFile(audio)), {
            accountId: cfAccount,
            token: env.CF_AI_TOKEN!,
            fetch: fetchImpl,
          });
          await mkdir(out, { recursive: true });
          await writeFile(join(out, `${stem}.vtt`), vtt);
          files.captions = `${stem}.vtt`;
        }
      } catch (err) {
        delete files.captions;
        lines.push(`WARN captions: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const encodedAt = now();
    const dir = `${profile}-${versionStamp(encodedAt)}`;
    const manifest = parseManifest({
      version: 1,
      source: sourcePath,
      class: profile,
      key,
      dir,
      encodedAt: encodedAt.toISOString(),
      files,
    } satisfies VideoManifest);
    if (manifest === null) throw new StepError("manifest", "built manifest failed its own parse");

    const uploads: string[] = [
      files.mp4,
      files.mobileMp4,
      files.webm,
      files.poster,
      files.captions,
    ].filter((f): f is string => f !== undefined);
    for (const file of uploads) {
      const bytes = await readFile(join(out, file));
      const objectKey = `${key}/${dir}/${file}`;
      try {
        await putObject(cfg, objectKey, new Uint8Array(bytes), {
          contentType: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          cacheControl: IMMUTABLE,
          fetch: fetchImpl,
          now: now(),
        });
      } catch (err) {
        throw new StepError(objectKey, err instanceof Error ? err.message : String(err));
      }
      lines.push(`PUT ${objectKey} ${bytes.length}`);
    }
    // A player manifest can land while this run downloads and encodes (a concurrent player run). Re-check
    // just before the PUT, so a background run never overwrites it.
    if (profile === "background") {
      let latest: VideoManifest | null = null;
      try {
        const bytes = await getObject(cfg, manifestKey, { fetch: fetchImpl, now: now() });
        if (bytes !== null) {
          try {
            latest = parseManifest(JSON.parse(new TextDecoder().decode(bytes)));
          } catch {
            latest = null;
          }
        }
      } catch (err) {
        throw new StepError(manifestKey, err instanceof Error ? err.message : String(err));
      }
      if (latest !== null && latest.class === "player") {
        lines.push(`SKIP ${key}: a player manifest landed during this run (${latest.dir})`);
        return { output: lines.join("\n"), code: 0 };
      }
    }
    try {
      await putObject(
        cfg,
        manifestKey,
        new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
        {
          contentType: "application/json",
          cacheControl: MANIFEST_CACHE,
          fetch: fetchImpl,
          now: now(),
        },
      );
    } catch (err) {
      throw new StepError(manifestKey, err instanceof Error ? err.message : String(err));
    }
    lines.push(`MANIFEST ${manifestKey}`);
    return { output: lines.join("\n"), code: 0 };
  } catch (err) {
    if (err instanceof StepError) return { output: [...lines, err.message].join("\n"), code: 1 };
    throw err;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
