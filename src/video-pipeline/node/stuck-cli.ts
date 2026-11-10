// `reddoor-maint video-pipeline stuck`: lists videos that have sat on Prismic
// without an R2 manifest, and opens or updates the tracking issue. Node-only.
import { readFile as fsReadFile } from "node:fs/promises";
import { findVideos, mergeFound, parseVideoRules } from "../classify.js";
import type { DocLike, VideoRules } from "../classify.js";
import { REPO_NAME } from "../dispatch.js";
import { SITE_NAME, videoKey } from "../key.js";
import {
  STUCK_LABEL,
  STUCK_TITLE,
  cannotEncodeReason,
  findStuck,
  stuckIssueBody,
} from "../stuck.js";
import type { Renditions } from "../manifest.js";
import { resolveVideo } from "../manifest.js";

export type StuckOptions = {
  site?: string | undefined;
  repo?: string | undefined;
  prismic?: string | undefined;
  mediaBase?: string | undefined;
  rules?: string | undefined;
  openIssue?: boolean | undefined;
};

export type StuckDeps = {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  readFile?: (p: string) => Promise<string>;
  now?: () => Date;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The body of a 2xx Prismic response as JSON. Anything else throws `FAILED prismic: ...`. */
async function prismicJson(res: Response): Promise<unknown> {
  if (res.status < 200 || res.status > 299) {
    const text = await res.text().catch(() => "");
    throw new Error(`FAILED prismic: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`FAILED prismic: HTTP ${res.status} body is not JSON`);
  }
}

/** Every document on the master ref. Throws `FAILED prismic: ...` on any non-2xx, or a body without a master ref or a results array. */
async function fetchAllDocuments(
  repo: string,
  fetchImpl: typeof fetch,
  token: string | undefined,
): Promise<DocLike[]> {
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  const apiUrl = `https://${repo}.cdn.prismic.io/api/v2${q}`;
  const info = await prismicJson(await fetchImpl(apiUrl));
  const refs = isObject(info) && Array.isArray(info.refs) ? info.refs : [];
  const master = refs.find(
    (r): r is { ref: string; isMasterRef: true } => isObject(r) && r.isMasterRef === true,
  );
  if (master === undefined || typeof master.ref !== "string") {
    throw new Error("FAILED prismic: the api response has no master ref");
  }
  const docs: DocLike[] = [];
  let page = 1;
  for (;;) {
    const params = `ref=${encodeURIComponent(master.ref)}&pageSize=100&page=${page}&lang=*${token ? `&access_token=${encodeURIComponent(token)}` : ""}`;
    const body = await prismicJson(
      await fetchImpl(`https://${repo}.cdn.prismic.io/api/v2/documents/search?${params}`),
    );
    if (!isObject(body) || !Array.isArray(body.results)) {
      throw new Error("FAILED prismic: the search response has no results array");
    }
    docs.push(...(body.results as DocLike[]));
    const total = typeof body.total_pages === "number" ? body.total_pages : undefined;
    if (total === undefined || page >= total) break;
    page += 1;
  }
  return docs;
}

type IssueRef = { number: number; body?: string; pull_request?: unknown };

/** A Prismic repository name: the subdomain of <name>.cdn.prismic.io, so no slash, dot or colon can reach the URL. */
const PRISMIC_REPO = /^[a-z0-9][a-z0-9-]*$/i;

/** Every slice_type that appears in an array of any document's data: the same walk findVideos makes. */
function sliceTypesOf(docs: DocLike[]): Set<string> {
  const seen = new Set<string>();
  for (const doc of docs) {
    if (!isObject(doc.data)) continue;
    for (const value of Object.values(doc.data)) {
      if (!Array.isArray(value)) continue;
      for (const slice of value) {
        if (isObject(slice) && typeof slice.slice_type === "string") seen.add(slice.slice_type);
      }
    }
  }
  return seen;
}

/** Opens or updates the tracking issue. Returns the output line. */
async function syncIssue(
  repo: string,
  token: string,
  body: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  const listRes = await fetchImpl(
    `https://api.github.com/repos/${repo}/issues?state=open&labels=${STUCK_LABEL}&per_page=10`,
    { headers },
  );
  if (!listRes.ok) throw new Error(`list issues: HTTP ${listRes.status}`);
  // The issues endpoint also lists pull requests; only a real issue is the tracking issue.
  const open = ((await listRes.json()) as IssueRef[]).filter((i) => i.pull_request === undefined);
  const existing = open[0];
  if (existing) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues/${existing.number}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`update issue #${existing.number}: HTTP ${res.status}`);
    return `UPDATED #${existing.number}`;
  }
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: STUCK_TITLE, body, labels: [STUCK_LABEL] }),
  });
  if (!res.ok) throw new Error(`open issue: HTTP ${res.status}`);
  const created = (await res.json()) as IssueRef;
  return `OPENED #${created.number}`;
}

export async function runPipelineStuck(
  opts: StuckOptions,
  deps: StuckDeps = {},
): Promise<{ output: string; code: number }> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const readFile = deps.readFile ?? ((p: string) => fsReadFile(p, "utf-8"));
  const now = deps.now ?? (() => new Date());

  if (!opts.rules) return { output: "--rules <path> is required", code: 2 };
  let rules: VideoRules;
  try {
    const parsed = parseVideoRules(JSON.parse(await readFile(opts.rules)));
    if (typeof parsed === "string") return { output: `--rules: ${parsed}`, code: 2 };
    rules = parsed;
  } catch (err) {
    return {
      output: `--rules ${opts.rules}: ${err instanceof Error ? err.message : String(err)}`,
      code: 2,
    };
  }
  if (!opts.prismic) return { output: "--prismic <repo> is required", code: 2 };
  if (!PRISMIC_REPO.test(opts.prismic)) {
    return {
      output: `--prismic must be a Prismic repository name (letters, digits, hyphens); got ${JSON.stringify(opts.prismic)}`,
      code: 2,
    };
  }
  // cac passes numeric option values as numbers: coerce, then check the name before anything is fetched.
  const site = opts.site == null ? "" : String(opts.site);
  if (!SITE_NAME.test(site)) {
    return {
      output: `--site must be a site name (a lowercase letter, then letters, digits or hyphens); got ${JSON.stringify(site)}`,
      code: 2,
    };
  }
  if (!opts.mediaBase) return { output: "--media-base <url> is required", code: 2 };
  if (opts.repo && !REPO_NAME.test(opts.repo)) {
    return { output: `--repo must be owner/name; got ${JSON.stringify(opts.repo)}`, code: 2 };
  }

  let docs: DocLike[];
  try {
    docs = await fetchAllDocuments(opts.prismic, fetchImpl, env.PRISMIC_ACCESS_TOKEN);
  } catch (err) {
    return { output: err instanceof Error ? err.message : String(err), code: 2 };
  }
  if (docs.length === 0) return { output: "FAILED prismic: no documents", code: 2 };
  // A rules key that names no slice in any document is a typo or a dead rule: say so, without changing the exit code.
  const seenSlices = sliceTypesOf(docs);
  const warnings = Object.keys(rules)
    .filter((k) => k !== "$document" && !seenSlices.has(k))
    .map((k) => `WARN rules: ${k} matched no slice in ${docs.length} documents`);
  const found = mergeFound(docs.flatMap((d) => findVideos(d, rules)));
  const cache = new Map<string, Promise<Renditions>>();
  const resolved = new Map<string, Renditions>();
  for (const video of found) {
    resolved.set(
      video.url,
      await resolveVideo(video.url, {
        site,
        mediaBase: opts.mediaBase,
        fetch: fetchImpl,
        cache,
      }),
    );
  }
  const current = now();
  const stuck = findStuck(found, resolved, current);
  const lines = [...warnings];
  lines.push(
    ...stuck.map((v) => {
      const reason = cannotEncodeReason(v.url, site);
      if (reason !== null) return `cannot be encoded (${reason}): ${v.url}`;
      const age = v.ageMs === null ? "unknown" : `${Math.round(v.ageMs / 60000)}min`;
      return `STUCK ${v.url} class=${v.class} document=${v.documentId} age=${age} key=${videoKey(site, v.url)}`;
    }),
  );
  lines.push(`documents: ${docs.length}, videos: ${found.length}`);
  lines.push(`stuck: ${stuck.length} of ${found.length} video(s)`);

  if (opts.openIssue && stuck.length > 0) {
    if (!env.GITHUB_TOKEN)
      return { output: [...lines, "--open-issue needs GITHUB_TOKEN"].join("\n"), code: 2 };
    if (!opts.repo)
      return { output: [...lines, "--open-issue needs --repo owner/name"].join("\n"), code: 2 };
    try {
      lines.push(
        await syncIssue(
          opts.repo!,
          env.GITHUB_TOKEN!,
          stuckIssueBody(stuck, current, site),
          fetchImpl,
        ),
      );
    } catch (err) {
      return {
        output: [
          ...lines,
          `FAILED issue: ${err instanceof Error ? err.message : String(err)}`,
        ].join("\n"),
        code: 1,
      };
    }
  }
  // Exit 1 when anything is stuck is deliberate: the hourly run going red is the alarm. Stage 1 never
  // closes the issue on its own; a stuck video that is later encoded simply stops appearing here.
  return { output: lines.join("\n"), code: stuck.length > 0 ? 1 : 0 };
}
