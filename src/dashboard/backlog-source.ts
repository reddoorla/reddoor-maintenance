import {
  BACKLOG_PATH,
  BacklogParseError,
  WORKSPACE_REPO,
  topBacklogItems,
  type BacklogItem,
} from "./backlog.js";

/**
 * What the Triage page shows for the backlog (P1-111): its top five P1 items,
 * read from the private workspace repo on each request, or why they could not
 * be. Read at request time on the server because this repo is public: no
 * backlog text is committed, built or logged here (`./backlog.ts`).
 */
export type BacklogPanel =
  | {
      kind: "ok";
      items: BacklogItem[];
      rerankedAt: string | null;
      /** When BACKLOG.md was last committed to the workspace's default branch, or null if unknown. */
      writtenAt: string | null;
    }
  | { kind: "unavailable"; reason: string };

const GITHUB_API = "https://api.github.com";
const TIMEOUT_MS = 10_000;

function headers(token: string, accept: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept,
    "x-github-api-version": "2022-11-28",
    "user-agent": "reddoor-maintenance-dashboard",
  };
}

/** Why GitHub refused, in words the operator can act on. Never the response body. */
function refusal(status: number): string {
  if (status === 401) return "GitHub refused the dashboard's GH_TOKEN (401).";
  if (status === 403 || status === 404) {
    return `GitHub answered ${status}: the dashboard's GH_TOKEN cannot read ${WORKSPACE_REPO}'s contents.`;
  }
  return `GitHub answered ${status} for ${WORKSPACE_REPO}/${BACKLOG_PATH}.`;
}

/** The newest commit date of BACKLOG.md, or null. Best effort: the panel shows without it. */
async function lastWritten(token: string, doFetch: typeof fetch): Promise<string | null> {
  try {
    const res = await doFetch(
      `${GITHUB_API}/repos/${WORKSPACE_REPO}/commits?path=${BACKLOG_PATH}&per_page=1`,
      {
        headers: headers(token, "application/vnd.github+json"),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ commit?: { committer?: { date?: string } } }>;
    const date = body[0]?.commit?.committer?.date;
    return typeof date === "string" && !Number.isNaN(Date.parse(date)) ? date : null;
  } catch {
    return null;
  }
}

export async function loadBacklogPanel(deps: {
  token: string | undefined;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}): Promise<BacklogPanel> {
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? ((line) => console.error(line));
  const token = deps.token?.trim();
  if (!token) return { kind: "unavailable", reason: "The dashboard has no GH_TOKEN set." };
  try {
    const [res, writtenAt] = await Promise.all([
      doFetch(`${GITHUB_API}/repos/${WORKSPACE_REPO}/contents/${BACKLOG_PATH}`, {
        headers: headers(token, "application/vnd.github.raw+json"),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      lastWritten(token, doFetch),
    ]);
    if (!res.ok) {
      log(`[triage:backlog] GitHub ${res.status} reading ${WORKSPACE_REPO}/${BACKLOG_PATH}`);
      return { kind: "unavailable", reason: refusal(res.status) };
    }
    const top = topBacklogItems(await res.text());
    return { kind: "ok", items: top.items, rerankedAt: top.rerankedAt, writtenAt };
  } catch (err) {
    // A parse error names a row ID or a line number, never the file's text, so it
    // is safe to show and to log. Anything else is logged by its name only.
    if (err instanceof BacklogParseError) {
      log(`[triage:backlog] ${err.message}`);
      return { kind: "unavailable", reason: `The backlog could not be read: ${err.message}.` };
    }
    const name = err instanceof Error ? err.name : "unknown error";
    log(`[triage:backlog] read failed: ${name}`);
    return { kind: "unavailable", reason: `Reading the backlog from GitHub failed (${name}).` };
  }
}
