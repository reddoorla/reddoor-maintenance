// `reddoor-maint video-pipeline stuck`: lists videos that have sat on Prismic
// without an R2 manifest, and opens or updates the tracking issue. Node-only.
import { readFile as fsReadFile } from "node:fs/promises";
import { findVideos, mergeFound } from "../classify.js";
import type { DocLike, VideoRules } from "../classify.js";
import { STUCK_LABEL, STUCK_TITLE, findStuck, stuckIssueBody } from "../stuck.js";
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

type PrismicPage = { results?: DocLike[]; page?: number; total_pages?: number };

async function fetchAllDocuments(
  repo: string,
  fetchImpl: typeof fetch,
  token: string | undefined,
): Promise<DocLike[]> {
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  const apiUrl = `https://${repo}.cdn.prismic.io/api/v2${q}`;
  const info = (await (await fetchImpl(apiUrl)).json()) as {
    refs?: { ref: string; isMasterRef?: boolean }[];
  };
  const ref = info.refs?.find((r) => r.isMasterRef)?.ref;
  if (!ref) throw new Error("Prismic API returned no master ref");
  const docs: DocLike[] = [];
  let page = 1;
  for (;;) {
    const params = `ref=${encodeURIComponent(ref)}&pageSize=100&page=${page}${token ? `&access_token=${encodeURIComponent(token)}` : ""}`;
    const body = (await (
      await fetchImpl(`https://${repo}.cdn.prismic.io/api/v2/documents/search?${params}`)
    ).json()) as PrismicPage;
    docs.push(...(body.results ?? []));
    if (body.total_pages === undefined || page >= body.total_pages) break;
    page += 1;
  }
  return docs;
}

type IssueRef = { number: number; body?: string };

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
  const open = (await listRes.json()) as IssueRef[];
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
    rules = JSON.parse(await readFile(opts.rules)) as VideoRules;
  } catch (err) {
    return {
      output: `--rules ${opts.rules}: ${err instanceof Error ? err.message : String(err)}`,
      code: 2,
    };
  }
  if (!opts.prismic) return { output: "--prismic <repo> is required", code: 2 };
  if (!opts.site) return { output: "--site <name> is required", code: 2 };

  const docs = await fetchAllDocuments(opts.prismic, fetchImpl, env.PRISMIC_ACCESS_TOKEN);
  const found = mergeFound(docs.flatMap((d) => findVideos(d, rules)));
  const cache = new Map<string, Promise<Renditions>>();
  const resolved = new Map<string, Renditions>();
  for (const video of found) {
    resolved.set(
      video.url,
      await resolveVideo(video.url, {
        site: opts.site,
        mediaBase: opts.mediaBase,
        fetch: fetchImpl,
        cache,
      }),
    );
  }
  const current = now();
  const stuck = findStuck(found, resolved, current);
  const lines = stuck.map(
    (v) =>
      `STUCK ${v.url} class=${v.class} document=${v.documentId} age=${v.ageMs === null ? "unknown" : `${Math.round(v.ageMs / 60000)}min`}`,
  );
  lines.push(`stuck: ${stuck.length} of ${found.length} video(s)`);

  if (opts.openIssue && stuck.length > 0) {
    if (!env.GITHUB_TOKEN)
      return { output: [...lines, "--open-issue needs GITHUB_TOKEN"].join("\n"), code: 2 };
    if (!opts.repo)
      return { output: [...lines, "--open-issue needs --repo owner/name"].join("\n"), code: 2 };
    try {
      lines.push(
        await syncIssue(opts.repo!, env.GITHUB_TOKEN!, stuckIssueBody(stuck, current), fetchImpl),
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
  return { output: lines.join("\n"), code: stuck.length > 0 ? 1 : 0 };
}
