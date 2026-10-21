#!/usr/bin/env node
// The Monday outcome ledger (P1-33 next-8; the workspace's
// reviews/2026-10-06-two-touch-review/recommendations.md "next" 8). Six lines or fewer about
// one week, PT: open asks, asks answered with repository latency, asks born, release-PR
// waits, fix-of-fix PRs and reverts. It stores nothing.
//
// The asks come from the home base's git history, not from its working tree: an ask counts
// only once it is on `--rev` (origin/main), it is born at its `asked` time, and it is answered
// when a commit on that branch's first-parent line first gives it `status: answered`. That
// gap is repository latency (asked → the answer on main), never the operator's response time.
// The "reports awaiting approval" line of the recommendation is left out: those rows live
// in Turso, which this script does not read.
import { realRunner } from "./land-prs.mjs";
import { parseDecision, IGNORED_ENTRIES, HOME_REPO } from "./decisions.mjs";
import { flagValue, isMain } from "./lib/cli.mjs";

const USAGE =
  "usage: node scripts/operator-ledger.mjs <home base> [--week YYYY-MM-DD] [--rev origin/main] [--repo owner/repo] [--json]\n" +
  "       --week names the Monday the week ends on (00:00 PT, not included); default: the latest Monday";

export const TZ = "America/Los_Angeles";
const DAY = 86_400_000;
export const FIX_WINDOW_MS = 7 * DAY;
const DECISIONS_DIR = "decisions";
const ASK_ID_PREFIX = `${DECISIONS_DIR}/YYYY-MM-DD-HHMM-`.length;
const MAX_PAGES = 30;
export const RELEASE_TITLE = /^chore\(release\)/i;
export const FIX_TITLE = /^fix(?:\([^)]*\))?!?:/i;
export const REVERT_TITLE = /^revert\b/i;
export const REVIEW_STOP_SLUG =
  /(?:^|-)round-(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:-|$)/;

export function parseArgs(argv) {
  const o = { home: undefined, week: undefined, rev: "origin/main", repo: HOME_REPO, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => flagValue(argv[++i], a);
    if (a === "--week") {
      const v = next();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !sameDate(v))
        throw new Error(`--week needs YYYY-MM-DD: ${v}`);
      const [y, m, d] = v.split("-").map(Number);
      if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 1)
        throw new Error(`--week names the Monday the week ends on; ${v} is not a Monday`);
      o.week = v;
    } else if (a === "--rev") o.rev = next();
    else if (a === "--repo") {
      const v = next();
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v))
        throw new Error(`--repo needs owner/repo: ${v}`);
      o.repo = v;
    } else if (a === "--json") o.json = true;
    else if (a.startsWith("-")) throw new Error(`unknown argument: ${a}`);
    else if (o.home === undefined) o.home = a;
    else throw new Error(`one home base path only, got a second: ${a}`);
  }
  if (!o.home) throw new Error("the home base path is required");
  return o;
}

function sameDate(v) {
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const PT_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

/** The PT wall clock at `ms`, as numbers. */
export function ptParts(ms) {
  const p = Object.fromEntries(PT_PARTS.formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, weekday: p.weekday };
}

const offsetAt = (ms) => {
  const p = ptParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000;
};

/** The UTC instant of 00:00 PT on the calendar date y-m-d (DST-aware). */
export function ptMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  const t = guess - offsetAt(guess);
  return guess - offsetAt(t);
}

const ymd = (v) => v.split("-").map(Number);
const dateStr = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
};

/** [start, end) for the week ending at 00:00 PT on `week`: the seven PT days before it. */
export function weekWindow(week) {
  const [y, m, d] = ymd(week);
  const startDate = dateStr(y, m, d - 7);
  return {
    start: ptMidnight(...ymd(startDate)),
    end: ptMidnight(y, m, d),
    startDate,
    endDate: week,
  };
}

/** The latest Monday, PT, on or before `now`. */
export function defaultWeek(now) {
  const p = ptParts(now);
  const back = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  return dateStr(p.y, p.m, p.d - back);
}

export const askKind = (slug) =>
  REVIEW_STOP_SLUG.test(slug ?? "") ? "review-round stop" : "other";

// ── the asks, from git ──────────────────────────────────────────────────────────────

async function git(run, home, args) {
  const r = await run("git", ["-C", home, ...args], { timeoutMs: 120_000 });
  if (r.code !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || "").trim().split("\n")[0]}`);
  return r.stdout;
}

/**
 * Every decision file on `rev`, with its status history along rev's first-parent line:
 * `events` is each commit that touched it (across renames), oldest first, with the status
 * that commit gave it. `errors` holds the final version's parse errors; `historyErrors` every
 * older
 * version whose status could not be read, so a skipped version never passes silently.
 */
export async function askTimelines(home, rev, run = realRunner) {
  if ((await git(run, home, ["rev-parse", "--is-shallow-repository"])).trim() === "true")
    throw new Error(
      `${home} is a shallow clone, so the first commits of older asks are cut off; run git -C ${home} fetch --unshallow origin first`,
    );
  if (rev.startsWith("-")) throw new Error(`--rev may not start with -: ${rev}`);
  const [sha, revIso] = (
    await git(run, home, ["log", "-1", "--format=%H%x09%cI", `${rev}^{commit}`])
  )
    .trim()
    .split("\t");
  const names = (
    await git(run, home, ["-c", "core.quotePath=false", "ls-tree", `${sha}:${DECISIONS_DIR}`])
  )
    .split("\n")
    // "<mode> <type> <sha>\t<name>": files only, so a subfolder is never read as an ask.
    .filter((l) => / blob [0-9a-f]+\t/.test(l))
    .map((l) => l.slice(l.indexOf("\t") + 1))
    .filter((n) => !IGNORED_ENTRIES.includes(n) && !n.startsWith("."));
  // One log of the directory, renames only, never copies: every ask starts from the same
  // template, and --follow or -C would graft one ask's history onto another's. A rename
  // counts only between two names of one ask (sameAsk below).
  const log = await git(run, home, [
    "-c",
    "core.quotePath=false",
    "log",
    "--first-parent",
    "--diff-merges=first-parent",
    "--reverse",
    "-M50%",
    "--name-status",
    "--format=%x00%H%x09%cI",
    sha,
    "--",
    DECISIONS_DIR,
  ]);
  const touched = new Map();
  for (const block of log.split("\0").slice(1)) {
    const [head, ...lines] = block.split("\n");
    const [commit, iso] = head.split("\t");
    const at = Date.parse(iso);
    const id = (p) => p.slice(0, ASK_ID_PREFIX);
    const slug = (p) => p.slice(ASK_ID_PREFIX);
    // One ask under two names, sharing the ask time or the slug
    // (a rename that corrects the time keeps the slug; one that renames the slug keeps the time).
    const sameAsk = (p1, p2) => id(p1) === id(p2) || slug(p1) === slug(p2);
    const changes = lines
      .map((l) => l.split("\t"))
      .filter(([st, p1]) => st && p1)
      .map(([st, p1, p2]) =>
        // A rename across ask times is two asks: the old one goes, a new one arrives.
        st.startsWith("R") && !sameAsk(p1, p2)
          ? [
              ["D", p1],
              ["A", p2],
            ]
          : [[st[0], p1, p2]],
      )
      .flat();
    // A delete and an add of the same ask time in one commit, alone on each side, is a
    // rename git scored below 50% (the answer grew); link them too.
    for (const del of changes.filter(([st]) => st === "D")) {
      const adds = changes.filter(([st, p]) => st === "A" && sameAsk(p, del[1]));
      const dels = changes.filter(
        ([st, p]) => st === "D" && adds.length === 1 && sameAsk(p, adds[0][1]),
      );
      if (adds.length === 1 && dels.length === 1) {
        adds[0].splice(0, 3, "R", del[1], adds[0][1]);
        del[0] = "-";
      }
    }
    for (const [st, p1, p2] of changes) {
      if (st === "R") {
        const h = touched.get(p1) ?? [];
        touched.delete(p1);
        touched.set(p2, [...h, { commit, at, path: p2 }]);
      } else if (st !== "-") {
        const gone = st === "D";
        touched.set(p1, [...(touched.get(p1) ?? []), { commit, at, path: p1, gone }]);
      }
    }
  }
  // An ask deleted from main still counts in the weeks it lived through, read from its last
  // version, so tidying the directory never rewrites a closed week.
  const deleted = [...touched]
    .filter(([p, h]) => h.at(-1).gone && p.startsWith(`${DECISIONS_DIR}/`))
    .map(([p]) => p.slice(DECISIONS_DIR.length + 1))
    .filter((n) => !n.includes("/") && !IGNORED_ENTRIES.includes(n) && !names.includes(n));
  const out = [];
  for (const name of [...names, ...deleted].sort()) {
    const history = touched.get(`${DECISIONS_DIR}/${name}`) ?? [];
    const last = history.filter((t) => !t.gone).at(-1);
    const finalRef = names.includes(name)
      ? `${sha}:${DECISIONS_DIR}/${name}`
      : `${last?.commit}:${last?.path}`;
    const final = parseDecision(name, await git(run, home, ["show", finalRef]), Infinity);
    const errors = [...final.errors];
    const historyErrors = [];
    const events = [];
    for (const t of history) {
      if (t.gone) {
        events.push({ at: t.at, status: "deleted" });
        continue;
      }
      const r = await run("git", ["-C", home, "show", `${t.commit}:${t.path}`], {
        timeoutMs: 60_000,
      });
      const status = r.code === 0 ? parseDecision(name, r.stdout, Infinity).status : undefined;
      if (status) events.push({ at: t.at, status });
      else historyErrors.push({ at: t.at, error: `no readable status at ${t.commit.slice(0, 7)}` });
    }
    out.push({
      file: name,
      slug: final.slug,
      asked: final.asked ? Date.parse(final.asked) : undefined,
      refs: final.refs,
      errors,
      historyErrors,
      events,
    });
  }
  return { sha, revAt: Date.parse(revIso), asks: out };
}

/** The status in force at `t`: the last event before it, or undefined before the first. */
const statusAt = (events, t) => events.filter((e) => e.at < t).at(-1)?.status;

/** Nearest-rank percentile of a sorted list; the median averages the middle two. */
export function median(sorted) {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function p90(sorted) {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(0.9 * sorted.length) - 1];
}

/** The ask half of the ledger, from timelines and a window. Pure. */
export function askLedger(asks, { start, end }) {
  const r = {
    open: [],
    answered: [],
    atBirth: [],
    born: [],
    unparsed: [],
    unreadable: [],
    backfilled: [],
  };
  for (const a of asks) {
    if (a.errors?.length || a.asked === undefined || a.events.length === 0) {
      r.unparsed.push(a.file);
      continue;
    }
    if (a.historyErrors?.some((e) => e.at < end)) r.unreadable.push(a.file);
    const birth = a.events[0];
    if (a.asked >= start && a.asked < end) r.born.push({ file: a.file, kind: askKind(a.slug) });
    // Answered at birth: it reached main answered and stayed so; its latency means nothing.
    // Only events before the end decide it, so a closed week never changes afterwards.
    const byEnd = a.events.filter((e) => e.at < end && e.status !== "deleted");
    if (
      birth.status === "answered" &&
      byEnd.length &&
      byEnd.every((e) => e.status === "answered")
    ) {
      if (birth.at >= start && birth.at < end) r.atBirth.push(a.file);
      continue;
    }
    // An ask asked before the end that first reached main after it is counted from its
    // `asked` time (the migrated asks of 2026-10-20), and the header says how many.
    const status = statusAt(a.events, end) ?? (birth.at >= end ? birth.status : undefined);
    if (a.asked < end && status === "open") {
      r.open.push({ file: a.file, asked: a.asked, refs: a.refs, ageMs: end - a.asked });
      if (birth.at >= end) r.backfilled.push(a.file);
    }
    // Answered in the week: a change into answered inside it (the first, if it was reopened).
    const into = a.events.find(
      (e, i) =>
        i > 0 &&
        e.status === "answered" &&
        a.events[i - 1].status !== "answered" &&
        e.at >= start &&
        e.at < end,
    );
    if (into) r.answered.push({ file: a.file, latencyMs: Math.max(0, into.at - a.asked) });
  }
  r.open.sort((x, y) => x.asked - y.asked);
  const lat = r.answered.map((x) => x.latencyMs).sort((x, y) => x - y);
  r.medianMs = median(lat);
  r.p90Ms = p90(lat);
  r.bornByKind = {};
  for (const b of r.born) r.bornByKind[b.kind] = (r.bornByKind[b.kind] ?? 0) + 1;
  return r;
}

// ── GitHub, by REST with manual paging ──────────────────────────────────────────────

async function ghJson(run, path) {
  const r = await run("gh", ["api", path], { timeoutMs: 60_000 });
  if (r.code !== 0)
    throw new Error(
      `gh api ${path} failed: ${(r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n")[0]}`,
    );
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`gh api ${path} returned something that is not JSON`);
  }
}

/** Open asks whose ref PR merged or closed after the ask and by the week's end. */
export async function staleAsks(open, end, run = realRunner) {
  const stale = [];
  const unchecked = [];
  for (const a of open) {
    let hit = false;
    for (const ref of a.refs ?? []) {
      const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(ref);
      let j;
      try {
        j = await ghJson(run, `repos/${m[1]}/${m[2]}/issues/${m[3]}`);
      } catch {
        if (!unchecked.includes(ref)) unchecked.push(ref);
        continue;
      }
      if (!j.pull_request) continue;
      const at = j.pull_request.merged_at ?? j.closed_at ?? null;
      if (at && Date.parse(at) > a.asked && Date.parse(at) < end) hit = true;
    }
    if (hit) stale.push(a.file);
  }
  return { stale, unchecked };
}

/** Every open PR, and every closed one updated at or after `since`, newest update first. */
export async function fetchPrs(repo, since, run = realRunner, perPage = 100) {
  const prs = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of open PRs in ${repo}`);
    const j = await ghJson(run, `repos/${repo}/pulls?state=open&per_page=${perPage}&page=${page}`);
    prs.push(...j);
    if (j.length < perPage) break;
  }
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of closed PRs in ${repo}`);
    const j = await ghJson(
      run,
      `repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
    );
    prs.push(...j);
    if (j.length < perPage || Date.parse(j[j.length - 1].updated_at) < since) break;
  }
  return prs;
}

// What a body must say before a PR for the PR to count as the one being fixed; a PR the body
// only cites for context does not count. The title counts every same-repo PR it names.
// A heuristic: it misses "Fixes [#58](url)" and the second number of "fixes #3, #4", and it
// counts "not a regression from #58". The line is a count to look into, not a verdict.
export const FIXES_PHRASE =
  /\b(?:fix(?:es|ed)?|repairs?|follow[- ]up (?:to|on|for)|regression (?:from|in|of)|broken? (?:by|in)|reverts?|caused by|introduced (?:by|in))\s+(?:PR\s+)?$/i;

/** Same-repo PR numbers `pr`'s title names, and those its body names as the PR it fixes. */
export function namedPrs(pr, repo) {
  const esc = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = new RegExp(
    `(?<![\\w/.-])#(\\d+)\\b|(?<![\\w-])${esc}#(\\d+)\\b|https://github\\.com/${esc}/(?:pull|issues)/(\\d+)\\b`,
    "g",
  );
  const out = new Set();
  for (const m of (pr.title ?? "").matchAll(ref)) out.add(Number(m[1] ?? m[2] ?? m[3]));
  const body = pr.body ?? "";
  for (const m of body.matchAll(ref))
    if (FIXES_PHRASE.test(body.slice(Math.max(0, m.index - 40), m.index)))
      out.add(Number(m[1] ?? m[2] ?? m[3]));
  out.delete(pr.number);
  return [...out];
}

/** The PR half of the ledger. Pure. */
export function prLedger(prs, { start, end }, repo) {
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  const merged = (p) => (p.merged_at ? Date.parse(p.merged_at) : null);
  const inWeek = (t) => t !== null && t >= start && t < end;
  const r = { releaseOpen: [], releaseMerged: [], fixOfFix: [], reverts: [] };
  for (const p of byNumber.values()) {
    const created = Date.parse(p.created_at);
    const m = merged(p);
    const closed = p.closed_at ? Date.parse(p.closed_at) : null;
    if (RELEASE_TITLE.test(p.title ?? "")) {
      if (created < end && (closed === null || closed >= end))
        r.releaseOpen.push({ number: p.number, waitMs: end - created });
      else if (inWeek(m)) r.releaseMerged.push({ number: p.number, waitMs: m - created });
      continue;
    }
    if (!inWeek(m)) continue;
    if (REVERT_TITLE.test(p.title ?? "")) r.reverts.push(p.number);
    if (FIX_TITLE.test(p.title ?? "") && p.user?.type !== "Bot") {
      const of = namedPrs(p, repo).filter((n) => {
        const t = byNumber.get(n) ? merged(byNumber.get(n)) : null;
        return t !== null && t < m && m - t <= FIX_WINDOW_MS;
      });
      if (of.length) r.fixOfFix.push({ number: p.number, of });
    }
  }
  for (const k of Object.keys(r)) r[k].sort((a, b) => (a.number ?? a) - (b.number ?? b));
  return r;
}

// ── the whole ledger ────────────────────────────────────────────────────────────────

export async function ledger(o, deps = {}) {
  const run = deps.run ?? realRunner;
  const now = deps.now ?? Date.now();
  const week = o.week ?? defaultWeek(now);
  const win = weekWindow(week);
  if (win.end > now)
    throw new Error(
      `the week ending ${week} 12:00am PT has not ended yet; its numbers would run past now`,
    );
  const { sha, revAt, asks } = await askTimelines(o.home, o.rev, run);
  const a = askLedger(asks, win);
  const s = await staleAsks(a.open, win.end, run);
  const prs = await fetchPrs(o.repo, win.start - FIX_WINDOW_MS, run, deps.perPage);
  const p = prLedger(prs, win, o.repo);
  const births = asks.flatMap((x) => (x.events.length ? [x.events[0].at] : []));
  const firstAskAt = births.length ? Math.min(...births) : null;
  return {
    week,
    ...win,
    rev: o.rev,
    sha,
    revAt,
    firstAskAt,
    repo: o.repo,
    asks: a,
    stale: s,
    prs: p,
  };
}

const ptDate = (ms) => {
  const p = ptParts(ms);
  return dateStr(p.y, p.m, p.d);
};
const days = (ms) => `${(ms / DAY).toFixed(1)}d`;
const prList = (xs) => xs.map((x) => `#${x.number} ${days(x.waitMs)}`).join(", ");

export function formatLedger(l) {
  const a = l.asks;
  const startDay = l.startDate;
  const [y, m, d] = ymd(l.endDate);
  const lastDay = dateStr(y, m, d - 1);
  const head =
    `OPERATOR_LEDGER ${startDay} to ${lastDay} PT (ends ${l.endDate} 12:00am PT) · home base ${l.rev} @${l.sha.slice(0, 7)}` +
    (l.revAt < l.end
      ? ` · NOTE ${l.rev}'s newest commit is older than the week's end; fetch it if it may be stale`
      : "") +
    // Before the 2026-10-20 cutover the asks lived in maintenance's docs/BACKLOG.md; only the
    // ones still open then became files, so a week that starts earlier is partial.
    (l.firstAskAt === null || l.start < l.firstAskAt
      ? ` · PARTIAL the first ask reached main ${l.firstAskAt === null ? "never" : ptDate(l.firstAskAt)}; asks answered before then are in ${HOME_REPO} docs/BACKLOG.md, and only the asks migrated open are counted here (open, born)`
      : "") +
    (a.backfilled.length
      ? ` · ${a.backfilled.length} open ask(s) reached main after the week and are counted from their asked time`
      : "") +
    (a.unparsed.length
      ? ` · ${a.unparsed.length} file(s) unparsed, not counted: ${a.unparsed.join(", ")}`
      : "") +
    (a.unreadable.length
      ? ` · ${a.unreadable.length} file(s) with an unreadable old version, counted from the rest: ${a.unreadable.join(", ")}`
      : "");
  const oldest = a.open[0];
  const open =
    `open asks at week end: ${a.open.length}` +
    (oldest ? ` · oldest ${days(oldest.ageMs)} (${oldest.file})` : "") +
    ` · stale ${l.stale.stale.length}` +
    (l.stale.unchecked.length ? ` (${l.stale.unchecked.length} ref(s) unchecked)` : "");
  const answered =
    `asks answered: ${a.answered.length}` +
    (a.answered.length
      ? ` · repository latency (asked → answer committed on main, not response time) median ${days(a.medianMs)}, p90 ${days(a.p90Ms)}`
      : "") +
    (a.atBirth.length ? ` · ${a.atBirth.length} answered at birth, not counted` : "");
  const kinds = Object.entries(a.bornByKind)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const born = `asks born: ${a.born.length}${kinds ? ` (${kinds})` : ""}, a description, not a target`;
  const rel =
    `release PRs: open at week end ${l.prs.releaseOpen.length ? prList(l.prs.releaseOpen) : "none"}` +
    ` · merged in the week ${l.prs.releaseMerged.length ? `${prList(l.prs.releaseMerged)} after opening` : "none"}`;
  const fixes =
    `fix-of-fix PRs within 7 days (a fix: PR naming the PR it fixes): ${l.prs.fixOfFix.length}` +
    (l.prs.fixOfFix.length
      ? ` (${l.prs.fixOfFix.map((f) => `#${f.number} after ${f.of.map((n) => `#${n}`).join(", ")}`).join("; ")})`
      : "") +
    ` · reverts: ${l.prs.reverts.length}` +
    (l.prs.reverts.length ? ` (${l.prs.reverts.map((n) => `#${n}`).join(", ")})` : "") +
    ` · ${l.repo}`;
  return [head, open, answered, born, rel, fixes].join("\n") + "\n";
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`operator-ledger: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const l = await ledger(o);
  process.stdout.write(o.json ? JSON.stringify(l, null, 2) + "\n" : formatLedger(l));
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`operator-ledger: ${e?.message ?? e}\n`);
    process.exitCode = 1;
  });
}
