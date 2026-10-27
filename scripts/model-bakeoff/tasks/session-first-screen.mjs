// P1-83d class (b): the PM pass's "First screen" lines from frozen command output. Every input
// is synthetic. Traps: the force-push log could not be read (never "none"), the backlog log is
// given unfiltered (a `Revert "pm: …"` subject does not start `pm:`), and one decision file is
// answered.
export const id = "session-first-screen";
export const title = "PM pass first screen from frozen outputs";

export const NOW = "2026-10-27T11:48:00Z";

export const CANARY =
  "Permission to use Bash with command rm -rf /tmp/deny-canary-absent has been denied.";
export const FORCE_PUSH =
  "could not read the push log (reddoorla/reddoor-workspace refs/heads/main)";
export const BACKLOG_LOG = [
  "a1b2c3d 2026-10-26T18:02:11Z pm: cockpit journal, Monday 10-26",
  "b2c3d4e 2026-10-26T19:40:00Z backlog: add P1-90 from a worker",
  "c3d4e5f 2026-10-26T21:15:30Z pm: re-rank after reddoorla/reddoor-maintenance#1702",
  'd4e5f6a 2026-10-27T02:03:09Z Revert "pm: drop P1-12"',
].join("\n");
export const DECISIONS = [
  ["2026-10-20-1916-alpha-cockpit-build-step", "answered", "2026-10-20T19:16:00Z"],
  ["2026-10-22-0410-bravo-dropbox-root", "open", "2026-10-22T04:10:00Z"],
  ["2026-10-21-1513-charlie-renovate-drought", "open", "2026-10-21T15:13:00Z"],
  ["2026-10-26-2230-delta-runner-rule", "open", "2026-10-26T22:30:00Z"],
];

const frontMatter = ([slug, status, asked]) =>
  `${slug}.md\n---\nstatus: ${status}\nasked: ${asked}\nfrom: reddoorla/reddoor-maintenance#1700\nrefs: []\n---`;

export function prompt() {
  return [
    `Write the four "First screen" lines of today's morning report, as \`pm-pass.md\` in this repository describes them, from the frozen outputs below. It is ${NOW} (UTC). Do not run the commands; they ran, and this is what they printed.`,
    "",
    "1. The canary printed:",
    CANARY,
    "",
    "2. The force-push log command printed:",
    FORCE_PUSH,
    "",
    "3. `git -C $WS log --format='%h %cI %s' <since>..origin/main -- BACKLOG.md` printed (before any filter):",
    BACKLOG_LOG,
    "",
    "4. `decisions.mjs check` passed. The decision files' front matter:",
    ...DECISIONS.map(frontMatter),
    "",
    "The json block's shape:",
    '{"canary": "refused" | "ran", "forcePushes": "none" | "count" | "unreadable", "backlogWithoutPm": [short shas], "openAsks": {"count": n, "oldestHours": hours as a number, "oldestSlug": file name without .md}, "lines": [the four report lines]}',
  ].join("\n");
}

export function truth() {
  const open = DECISIONS.filter(([, s]) => s === "open").sort((a, b) =>
    a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0,
  );
  const oldest = open[0];
  return {
    canary: /has been denied/.test(CANARY) ? "refused" : "ran",
    forcePushes: /could not read/.test(FORCE_PUSH) ? "unreadable" : "count",
    backlogWithoutPm: BACKLOG_LOG.split("\n")
      .map((l) => l.split(" "))
      .filter(([, , subject]) => !subject.startsWith("pm:"))
      .map(([sha]) => sha)
      .sort(),
    openAsks: {
      count: open.length,
      oldestHours: (Date.parse(NOW) - Date.parse(oldest[2])) / 3_600_000,
      oldestSlug: oldest[0],
    },
  };
}

export const checkCount = 6;

export function check(out, t) {
  const got = out ?? {};
  const shas = [...new Set((got.backlogWithoutPm ?? []).map((s) => String(s).slice(0, 7)))].sort();
  const hours = Number(got.openAsks?.oldestHours);
  return [
    { check: "canary", ok: got.canary === t.canary, got: got.canary, want: t.canary },
    {
      check: "forcePushes",
      ok: got.forcePushes === t.forcePushes,
      got: got.forcePushes,
      want: t.forcePushes,
    },
    {
      check: "backlogWithoutPm",
      ok: JSON.stringify(shas) === JSON.stringify(t.backlogWithoutPm),
      got: shas,
      want: t.backlogWithoutPm,
    },
    {
      check: "openAsks.count",
      ok: got.openAsks?.count === t.openAsks.count,
      got: got.openAsks?.count,
      want: t.openAsks.count,
    },
    {
      // The line prints whole or tenth hours; within one hour either way is right.
      check: "openAsks.oldestHours",
      ok: Number.isFinite(hours) && Math.abs(hours - t.openAsks.oldestHours) <= 1,
      got: got.openAsks?.oldestHours,
      want: t.openAsks.oldestHours,
    },
    {
      check: "openAsks.oldestSlug",
      ok: String(got.openAsks?.oldestSlug ?? "").replace(/\.md$/, "") === t.openAsks.oldestSlug,
      got: got.openAsks?.oldestSlug,
      want: t.openAsks.oldestSlug,
    },
  ];
}

export const arms = [
  { id: "sonnet-1", model: "sonnet" },
  { id: "sonnet-2", model: "sonnet" },
  { id: "opus-1", model: "opus" },
  { id: "opus-2", model: "opus" },
];
