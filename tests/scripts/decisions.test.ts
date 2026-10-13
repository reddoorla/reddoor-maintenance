import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  parseDecision,
  readDecisionDir,
  refState,
  decisionsReport,
  selectListed,
  formatCheck,
  formatList,
  sessionUrl,
  stamp,
  newDecision,
  backlogItems,
  classifyItem,
  originNeedles,
  itemTitle,
  itemAsk,
  itemLead,
  dedent,
  slugify,
  extractRefs,
  knownRepos,
  convertItem,
  convertBacklog,
  formatConvert,
  type RunResult,
  type Runner,
} from "../../scripts/decisions.mjs";

const SCRIPT = join(__dirname, "../../scripts/decisions.mjs");
const TEMPLATE = readFileSync(join(__dirname, "../fixtures/decisions/_template.md"), "utf-8");
const NOW = Date.parse("2026-10-13T12:00:00Z");
const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

const file = (o: {
  status?: string;
  asked?: string;
  from?: string;
  refs?: string;
  first?: string;
  extra?: string;
  answer?: string;
}) =>
  [
    "---",
    `status: ${o.status ?? "open"}`,
    `asked: ${o.asked ?? "AUTO"}`,
    `from: ${o.from ?? "https://claude.ai/code/session_01ABC"}`,
    `refs: ${o.refs ?? "[]"}`,
    ...(o.extra ? [o.extra] : []),
    "---",
    "",
    o.first ?? "Merge #12 now, or after the review?",
    "",
    "## Answer",
    "",
    ...[o.answer ?? (o.status === "answered" ? "(a), 2026-10-13." : "")]
      .filter(Boolean)
      .flatMap((a) => [a, ""]),
  ].join("\n");

const askedFromName = (name: string, text: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-/.exec(name);
  return m ? text.replace("asked: AUTO", `asked: ${m[1]}T${m[2]}:${m[3]}Z`) : text;
};

const pd = (name: string, text: string, now?: number) =>
  parseDecision(name, askedFromName(name, text), now);

const dirWith = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), "decisions-"));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), askedFromName(n, t));
  return d;
};

const cli = (args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const fakeGh =
  (byPath: Record<string, RunResult>): Runner =>
  async (cmd, args) => {
    if (cmd !== "gh" || args[0] !== "api") throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
    const r = byPath[args[1] ?? ""];
    if (!r) return { code: 1, stdout: "", stderr: `gh: Not Found (HTTP 404)\n` };
    return r;
  };

const pr = (merged_at: string | null, closed_at: string | null) =>
  ok(
    JSON.stringify({
      pull_request: { merged_at },
      closed_at,
      state: closed_at ? "closed" : "open",
    }),
  );

describe("parseDecision", () => {
  it("parses a well-formed file", () => {
    const d = pd(
      "2026-10-12-0900-merge-twelve.md",
      file({ refs: "[reddoorla/reddoor-maintenance#12, reddoorla/hedloc#55]" }),
    );
    expect(d.errors).toEqual([]);
    expect(d).toMatchObject({
      slug: "merge-twelve",
      status: "open",
      asked: "2026-10-12T09:00Z",
      from: "https://claude.ai/code/session_01ABC",
      refs: ["reddoorla/reddoor-maintenance#12", "reddoorla/hedloc#55"],
      ask: "Merge #12 now, or after the review?",
    });
  });

  it("accepts every known status and owner/repo#N as from", () => {
    for (const status of ["open", "answered", "parked", "withdrawn"])
      expect(
        pd("2026-10-12-0900-x.md", file({ status, from: "reddoorla/hedloc#55" })).errors,
      ).toEqual([]);
  });

  it("rejects an unknown status", () => {
    const d = pd("2026-10-12-0900-x.md", file({ status: "pending" }));
    expect(d.errors).toEqual(["unknown status: pending"]);
    expect(d.status).toBeUndefined();
  });

  it("rejects a missing first line, and a first line that is a heading", () => {
    expect(
      pd(
        "2026-10-12-0900-x.md",
        "---\nstatus: open\nasked: 2026-10-12T09:00Z\nfrom: a/b#1\nrefs: []\n---\n\n",
      ).errors,
    ).toEqual(["missing first line: the ask"]);
    expect(pd("2026-10-12-0900-x.md", file({ first: "## Answer" })).errors).toEqual([
      "missing first line: the ask",
    ]);
  });

  it("rejects a calendar-invalid asked, a name that disagrees with asked, and the TODO placeholder", () => {
    expect(pd("2026-02-30-1000-x.md", file({ asked: "2026-02-30T10:00Z" })).errors).toEqual([
      "asked is not a UTC time like 2026-10-13T13:51Z: 2026-02-30T10:00Z",
    ]);
    expect(pd("2026-10-13-1351-x.md", file({ asked: "2025-01-01T00:00Z" })).errors).toEqual([
      "file name time 2026-10-13T13:51Z does not match asked 2025-01-01T00:00Z",
    ]);
    expect(
      pd("2026-10-13-1351-x.md", file({ first: "TODO the ask, in one line." })).errors,
    ).toEqual(["the ask is still the TODO placeholder"]);
  });

  it("takes a first line that starts with a PR number, which is not a heading", () => {
    expect(pd("2026-10-12-0900-x.md", file({ first: "#918 / #920: land?" })).ask).toBe(
      "#918 / #920: land?",
    );
  });

  it("names every malformed field", () => {
    const d = pd(
      "notes.md",
      file({
        asked: "2026-10-12 09:00",
        from: "somebody",
        refs: "[#12, hedloc#5]",
        extra: "owner: me",
      }),
    );
    expect(d.errors).toEqual([
      "file name is not <YYYY-MM-DD-HHMM>-<slug>.md",
      "asked is not a UTC time like 2026-10-13T13:51Z: 2026-10-12 09:00",
      "from is neither a session URL nor owner/repo#N: somebody",
      "ref is not owner/repo#N: #12",
      "ref is not owner/repo#N: hedloc#5",
      "unknown front matter field: owner",
    ]);
  });

  it("rejects missing and repeated fields, and a file with no front matter", () => {
    expect(
      pd("2026-10-12-0900-x.md", "---\nstatus: open\nstatus: open\n---\nAsk?\n").errors,
    ).toEqual([
      "front matter field given twice: status",
      "missing front matter field: asked",
      "missing front matter field: from",
      "missing front matter field: refs",
    ]);
    expect(pd("2026-10-12-0900-x.md", "Ask?\n").errors).toEqual([
      "no front matter: the first line is not ---",
    ]);
    expect(pd("2026-10-12-0900-x.md", "---\nstatus: open\nAsk?\n").errors).toEqual([
      "front matter is not closed with ---",
    ]);
  });

  it("parses the shipped template once it is given a real name", () => {
    expect(pd("2026-10-13-1351-example.md", TEMPLATE).errors).toEqual([]);
  });
});

describe("check", () => {
  it("passes a known-good directory and skips the template and README", () => {
    const d = dirWith({
      "2026-10-12-0900-a.md": file({}),
      "_template.md": "not a decision",
      "README.md": "# Decisions",
    });
    const r = cli(["check", d, "--offline"]);
    expect(r.out).toBe("DECISIONS_SUMMARY parsed=1 errors=0 open=1 parked=0 unchecked=0\n");
    expect(r.code).toBe(0);
  });

  it("fails on a file with an unknown status, through the CLI", () => {
    const d = dirWith({
      "2026-10-12-0900-a.md": file({}),
      "2026-10-12-0901-b.md": file({ status: "pending" }),
    });
    const r = cli(["check", d, "--offline"]);
    expect(r.out).toBe(
      "DECISIONS_SUMMARY parsed=1 errors=1 open=1 parked=0 unchecked=0\nERROR 2026-10-12-0901-b.md: unknown status: pending\n",
    );
    expect(r.code).toBe(1);
  });

  it("fails when nothing parsed, so an empty or wrong directory is not a pass", () => {
    const d = dirWith({ "_template.md": TEMPLATE });
    const r = cli(["check", d, "--offline"]);
    expect(r.out).toBe(
      `DECISIONS_SUMMARY parsed=0 errors=0 open=0 parked=0 unchecked=0\nERROR ${d}: no decision file parsed\n`,
    );
    expect(r.code).toBe(1);
  });

  it("gives the four-file fixture 1 open, 1 answered, 1 parked and 1 error", async () => {
    const d = dirWith({
      "2026-10-12-0900-open.md": file({}),
      "2026-10-12-0901-answered.md": file({ status: "answered" }),
      "2026-10-12-0902-parked.md": file({ status: "parked" }),
      "2026-10-12-0903-broken.md": "no front matter\n",
    });
    const rep = await decisionsReport({ dir: d, offline: true }, { now: NOW });
    expect(rep.counts).toEqual({ parsed: 3, errors: 1, open: 1, parked: 1, unchecked: 0 });
    expect(rep.ok).toBe(false);
    expect(selectListed(rep, { open: true }).map((x) => x.slug)).toEqual(["open"]);
    expect(selectListed(rep, { parked: true }).map((x) => x.slug)).toEqual(["parked"]);
    expect(formatCheck(rep)).toContain("ERROR 2026-10-12-0903-broken.md: no front matter");
  });
});

describe("list", () => {
  const three = () =>
    dirWith({
      "2026-10-12-0900-middle.md": file({ asked: "2026-10-12T09:00Z", first: "Middle?" }),
      "2026-10-10-0800-oldest.md": file({ asked: "2026-10-10T08:00Z", first: "Oldest?" }),
      "2026-10-13-1100-newest.md": file({ asked: "2026-10-13T11:00Z", first: "Newest?" }),
      "2026-10-09-0800-parked.md": file({
        status: "parked",
        asked: "2026-10-09T08:00Z",
        first: "Parked?",
      }),
      "2026-10-08-0800-done.md": file({
        status: "answered",
        asked: "2026-10-08T08:00Z",
        first: "Done?",
      }),
    });

  it("lists open asks oldest first, with age, slug, first line and asking session", async () => {
    const rep = await decisionsReport({ dir: three(), offline: true }, { now: NOW });
    expect(formatList(rep, { open: true })).toBe(
      [
        "DECISIONS_SUMMARY parsed=5 errors=0 open=3 parked=1 unchecked=0",
        "3 open, oldest first",
        "- 76.0 h  2026-10-10-0800-oldest  Oldest?  (https://claude.ai/code/session_01ABC)",
        "- 27.0 h  2026-10-12-0900-middle  Middle?  (https://claude.ai/code/session_01ABC)",
        "- 1.0 h  2026-10-13-1100-newest  Newest?  (https://claude.ai/code/session_01ABC)",
        "",
      ].join("\n"),
    );
  });

  it("sorts by asked to the second, not by file name", async () => {
    const d = dirWith({
      "2026-10-12-0900-a.md": file({ asked: "2026-10-12T09:00:30Z" }),
      "2026-10-12-0900-b.md": file({ asked: "2026-10-12T09:00:10Z" }),
    });
    const rep = await decisionsReport({ dir: d, offline: true }, { now: NOW });
    expect(selectListed(rep, { open: true }).map((x) => x.slug)).toEqual(["b", "a"]);
  });

  it("keeps parked asks out of --open and shows them under --parked", async () => {
    const rep = await decisionsReport({ dir: three(), offline: true }, { now: NOW });
    const open = formatList(rep, { open: true });
    expect(open).not.toContain("Parked?");
    expect(open).not.toContain("Done?");
    expect(formatList(rep, { parked: true })).toContain(
      "- 100.0 h  2026-10-09-0800-parked  Parked?",
    );
  });

  it("--since keeps asks asked at or after the time", async () => {
    const rep = await decisionsReport({ dir: three(), offline: true }, { now: NOW });
    expect(
      selectListed(rep, { open: true, since: "2026-10-12T09:00Z" }).map((x) => x.slug),
    ).toEqual(["middle", "newest"]);
  });

  it("runs end to end through the CLI", () => {
    const r = cli(["list", three(), "--open", "--offline"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n").slice(0, 3)).toEqual([
      "DECISIONS_SUMMARY parsed=5 errors=0 open=3 parked=1 unchecked=0",
      "3 open, oldest first",
      expect.stringMatching(/^- \d+\.\d h {2}2026-10-10-0800-oldest {2}Oldest\?/),
    ]);
  });
});

describe("refs", () => {
  const ASKED = "2026-10-12T09:00Z";
  const P = "repos/reddoorla/reddoor-maintenance/issues/";

  it("flags a ref PR merged after the ask was asked", async () => {
    const run = fakeGh({ [`${P}1`]: pr("2026-10-12T10:00:00Z", "2026-10-12T10:00:00Z") });
    expect(await refState("reddoorla/reddoor-maintenance#1", ASKED, run)).toEqual({
      ref: "reddoorla/reddoor-maintenance#1",
      kind: "stale",
      event: "merged",
      at: "2026-10-12T10:00:00Z",
    });
  });

  it("does not flag a ref PR merged before the ask, the #957 shape", async () => {
    const run = fakeGh({ [`${P}957`]: pr("2026-10-12T08:59:00Z", "2026-10-12T08:59:00Z") });
    expect(await refState("reddoorla/reddoor-maintenance#957", ASKED, run)).toEqual({
      ref: "reddoorla/reddoor-maintenance#957",
      kind: "ok",
    });
  });

  it("flags a PR closed unmerged after the ask, and leaves open PRs and issues alone", async () => {
    const run = fakeGh({
      [`${P}2`]: pr(null, "2026-10-13T00:00:00Z"),
      [`${P}3`]: pr(null, null),
      [`${P}4`]: ok(JSON.stringify({ closed_at: "2026-10-13T00:00:00Z", state: "closed" })),
    });
    expect((await refState("reddoorla/reddoor-maintenance#2", ASKED, run)).kind).toBe("stale");
    expect((await refState("reddoorla/reddoor-maintenance#3", ASKED, run)).kind).toBe("ok");
    expect((await refState("reddoorla/reddoor-maintenance#4", ASKED, run)).kind).toBe("issue");
  });

  it("prints UNCHECKED for a repo the session cannot read, and counts it", async () => {
    const d = dirWith({
      "2026-10-12-0900-a.md": file({
        refs: "[reddoorla/reddoor-maintenance#1, reddoorla/private-site#7, reddoorla/reddoor-maintenance#957]",
      }),
    });
    const run = fakeGh({
      [`${P}1`]: pr("2026-10-12T10:00:00Z", "2026-10-12T10:00:00Z"),
      [`${P}957`]: pr("2026-10-12T08:00:00Z", "2026-10-12T08:00:00Z"),
    });
    const rep = await decisionsReport({ dir: d }, { now: NOW, run });
    expect(rep.counts.unchecked).toBe(1);
    expect(rep.ok).toBe(true);
    expect(formatList(rep, { open: true }).split("\n").slice(2)).toEqual([
      "- 27.0 h  2026-10-12-0900-a  Merge #12 now, or after the review?  (https://claude.ai/code/session_01ABC)",
      "    possibly stale: reddoorla/reddoor-maintenance#1 merged 2026-10-12T10:00:00Z, after it was asked",
      "    UNCHECKED reddoorla/private-site#7: gh: Not Found (HTTP 404)",
      "",
    ]);
  });

  it("treats a runner that throws or returns non-JSON as UNCHECKED", async () => {
    const boom: Runner = async () => {
      throw new Error("spawn gh ENOENT");
    };
    expect(await refState("a/b#1", ASKED, boom)).toEqual({
      ref: "a/b#1",
      kind: "unchecked",
      why: "spawn gh ENOENT",
    });
    expect((await refState("a/b#1", ASKED, async () => ok("<html>"))).kind).toBe("unchecked");
  });

  it("looks up refs only for open asks", async () => {
    const calls: string[] = [];
    const run: Runner = async (_c, args) => {
      calls.push(args[1] ?? "");
      return pr(null, null);
    };
    const d = dirWith({
      "2026-10-12-0900-a.md": file({ status: "answered", refs: "[a/b#1]" }),
      "2026-10-12-0901-b.md": file({ refs: "[a/b#2]" }),
    });
    await decisionsReport({ dir: d }, { now: NOW, run });
    expect(calls).toEqual(["repos/a/b/issues/2"]);
  });
});

describe("parseArgs", () => {
  it("parses each command", () => {
    expect(parseArgs(["check", "d"])).toMatchObject({ cmd: "check", dir: "d", offline: false });
    expect(parseArgs(["list", "d", "--open", "--since", "2026-10-12T00:00Z"])).toMatchObject({
      open: true,
      since: "2026-10-12T00:00Z",
    });
    expect(parseArgs(["new", "d", "my-ask", "--from", "reddoorla/hedloc#5"])).toMatchObject({
      slug: "my-ask",
      from: "reddoorla/hedloc#5",
    });
    expect(parseArgs(["convert", "out"])).toMatchObject({ rev: "origin/main" });
  });

  it("refuses ambiguous or malformed input", () => {
    expect(() => parseArgs([])).toThrow("needs a command");
    expect(() => parseArgs(["list", "d"])).toThrow("exactly one of --open or --parked");
    expect(() => parseArgs(["list", "d", "--open", "--parked"])).toThrow("exactly one");
    expect(() => parseArgs(["check", "d", "--open"])).toThrow("belong to list");
    expect(() => parseArgs(["check"])).toThrow("1 positional");
    expect(() => parseArgs(["list", "d", "--open", "--since", "yesterday"])).toThrow("ISO time");
    expect(() => parseArgs(["new", "d", "x", "--from", "hedloc#5"])).toThrow("owner/repo#N");
    expect(() => parseArgs(["check", "d", "--bogus"])).toThrow("unknown argument");
    expect(cli(["list", "d"]).code).toBe(2);
  });
});

describe("new", () => {
  it("derives the session URL from CLAUDE_CODE_REMOTE_SESSION_ID", () => {
    expect(sessionUrl("cse_01TMkyXc")).toBe("https://claude.ai/code/session_01TMkyXc");
    expect(sessionUrl("session_01TMkyXc")).toBe("https://claude.ai/code/session_01TMkyXc");
    expect(sessionUrl(undefined)).toBeUndefined();
    expect(sessionUrl("01TMkyXc")).toBeUndefined();
  });

  it("writes a file named from the clock that check refuses until the ask is filled in", () => {
    expect(stamp(Date.parse("2026-10-13T13:51:42Z"))).toEqual({
      asked: "2026-10-13T13:51:42Z",
      prefix: "2026-10-13-1351",
    });
    const n = newDecision({
      slug: "merge-twelve",
      from: "https://claude.ai/code/session_01A",
      now: NOW,
    });
    expect(n.name).toBe("2026-10-13-1200-merge-twelve.md");
    expect(pd(n.name, n.text).errors).toEqual(["the ask is still the TODO placeholder"]);
    expect(pd(n.name, n.text.replace("TODO the ask, in one line.", "Merge #12?")).errors).toEqual(
      [],
    );
    expect(() => newDecision({ slug: "Bad Slug", from: "a/b#1", now: NOW })).toThrow("slug");
  });

  it("writes through the CLI only with a derivable from", () => {
    const d = mkdtempSync(join(tmpdir(), "decisions-new-"));
    const env = { ...process.env, CLAUDE_CODE_REMOTE_SESSION_ID: "cse_01XYZ" };
    const r = spawnSync(process.execPath, [SCRIPT, "new", d, "an-ask"], { encoding: "utf-8", env });
    expect(r.status).toBe(0);
    const path = r.stdout.trim();
    expect(readFileSync(path, "utf-8")).toContain("from: https://claude.ai/code/session_01XYZ\n");
    expect(readDecisionDir(d).map((x) => x.errors)).toEqual([
      ["the ask is still the TODO placeholder"],
    ]);
    expect(cli(["check", d, "--offline"]).code).toBe(1);
    const again = spawnSync(process.execPath, [SCRIPT, "new", d, "an-ask"], {
      encoding: "utf-8",
      env,
    });
    if (readdirSync(d).length === 1) {
      expect(again.status).toBe(2);
      expect(again.stderr).toMatch(/^decisions: .* already exists\n$/);
    }
    const { CLAUDE_CODE_REMOTE_SESSION_ID: _, ...bare } = process.env;
    const r2 = spawnSync(process.execPath, [SCRIPT, "new", d, "other"], {
      encoding: "utf-8",
      env: bare,
    });
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain("CLAUDE_CODE_REMOTE_SESSION_ID is unset");
  });
});

const BACKLOG = [
  "# Backlog",
  "## P1 — next",
  "1. not a decision",
  "## Operator decisions (🔴 or product calls — agents prepare, never do)",
  "",
  "Ordered by what unblocks the most.",
  "",
  "13. **Google Maps keys (#754)** — add referrer and API restrictions to the three",
  "    keys in GCP, then close the four alerts.",
  "14. **Promotion authority** — decided 2026-09-29: identity B.",
  "87. **Dead letters wait two replay cycles before they alarm? (new 2026-10-05,",
  "    from issue #1190's inventory.)** A dead letter is CRITICAL from its first row.",
  "lazy continuation names roalson-interests#253 and reddoorla/.github#28.",
  "    - _Ask:_ (a) wait two replay cycles before alarming;",
  "      (b) keep alarming from the first row.",
  "    - _Pick:_ (a).",
  "",
  "88. **Answered elsewhere** — **Answered 2026-10-06 (AskUserQuestion): (a).**",
  "## Done",
  "- old",
].join("\n");

const byN = (n: number) => {
  const it = backlogItems(BACKLOG).find((i) => i.n === n);
  if (!it) throw new Error(`no item ${n}`);
  return it;
};

describe("convert", () => {
  it("splits the Operator decisions section into numbered items, lazy lines included", () => {
    const items = backlogItems(BACKLOG);
    expect(items.map((i) => [i.n, i.line])).toEqual([
      [13, 8],
      [14, 10],
      [87, 11],
      [88, 18],
    ]);
    expect(byN(87).text.split("\n")).toHaveLength(6);
    expect(backlogItems("# x\n## P1\n1. a")).toEqual([]);
  });

  it("marks answered items and leaves open ones", () => {
    expect(classifyItem(byN(13).text)).toEqual({ kind: "open", marker: null });
    expect(classifyItem(byN(87).text)).toEqual({ kind: "open", marker: null });
    expect(classifyItem(byN(14).text)).toEqual({ kind: "answered", marker: "decided 2026-09-29" });
    expect(classifyItem(byN(88).text)).toEqual({ kind: "answered", marker: "**Answered" });
    expect(
      classifyItem("24. **P1-12 (#995)**: held.\n    **Resolved 2026-09-29 ~21:45Z**: merged.")
        .kind,
    ).toBe("answered");
  });

  it("calls an item ambiguous when it reads answered only in prose, or says it is still open", () => {
    expect(
      classifyItem(
        "97. **Eight operator-only chores (new 2026-10-07)**: (a) to (g).\n    - (d) `#roalson-interests`, asked in the same line, is answered there.",
      ),
    ).toEqual({ kind: "ambiguous", marker: "answered" });
    expect(
      classifyItem(
        "18. **Standing product calls** — answered 2026-09-29, except #773:\n    - x\n    Still open, on the laptop: #773.",
      ).kind,
    ).toBe("ambiguous");
    expect(classifyItem("5. **x** — the job is done in the nightly.").kind).toBe("open");
  });

  it("searches the bold title as well as the head, so a reworded head keeps its first ask", () => {
    expect(originNeedles("10. **#918 / #920** — in a fix round after a four-lens review")).toEqual([
      "**#918 / #920** — in a fix round after a four-lens review",
      "**#918 / #920**",
    ]);
    expect(
      originNeedles("87. **Dead letters wait two replay cycles before they alarm? (new"),
    ).toEqual(["**Dead letters wait two replay cycles before they alarm? (ne"]);
  });

  it("reads title, ask, lead, refs and slug", () => {
    const [i13, i87] = [byN(13), byN(87)];
    expect(itemTitle(i87.text)).toBe(
      "Dead letters wait two replay cycles before they alarm? (new 2026-10-05, from issue #1190's inventory.)",
    );
    expect(itemAsk(i87.text)).toBe(
      "(a) wait two replay cycles before alarming; (b) keep alarming from the first row.",
    );
    expect(itemAsk(i13.text)).toBeNull();
    expect(itemLead(i13.text)).toBe(
      "Google Maps keys (#754) — add referrer and API restrictions to the three keys in GCP, then close the four alerts.",
    );
    const known = new Set([
      "reddoorla/reddoor-maintenance",
      "reddoorla/.github",
      "reddoorla/roalson-interests",
    ]);
    expect(extractRefs(i87.text, known)).toEqual({
      refs: ["reddoorla/roalson-interests#253", "reddoorla/.github#28"],
      dropped: ["#1190"],
    });
    expect(extractRefs("see #caltex and https://x.io/a#top and item #12")).toEqual({
      refs: ["reddoorla/reddoor-maintenance#12"],
      dropped: [],
    });
    expect(extractRefs("#545 and reddoorla/reddoor-maintenance#600")).toEqual({
      refs: ["reddoorla/reddoor-maintenance#600", "reddoorla/reddoor-maintenance#545"],
      dropped: [],
    });
  });

  it("leaves out a short repo name it cannot place, and a bare #N beside another repo", () => {
    const od113 =
      "vida#101 waits; lhy#33 is open, #29 and #30 are closed; `main-gate` (#98); see reddoorla/hedloc#55.";
    expect(extractRefs(od113)).toEqual({
      refs: ["reddoorla/hedloc#55"],
      dropped: ["vida#101", "lhy#33", "#29", "#30", "#98"],
    });
    expect(
      knownRepos("reddoorla/hedloc and someone/else and reddoorla/vida-legacy-foundation."),
    ).toEqual(
      new Set([
        "reddoorla/reddoor-maintenance",
        "reddoorla/.github",
        "reddoorla/hedloc",
        "reddoorla/vida-legacy-foundation",
      ]),
    );
    expect(slugify(13, "Google Maps keys (#754)")).toBe("od-13-google-maps-keys-754");
    expect(dedent("a\n    b\n      c\n\n    d")).toBe("a\nb\n  c\n\nd");
  });

  it("writes an item as a file check parses, and refuses one without a PR", () => {
    const i87 = byN(87);
    const origin = {
      sha: "a".repeat(40),
      time: Date.parse("2026-10-06T01:37:09Z") / 1000,
      subject: "docs: dead letters (#1199)",
    };
    const c = convertItem(i87, origin, "b".repeat(40));
    expect(c.name).toBe(
      "2026-10-06-0137-od-87-dead-letters-wait-two-replay-cycles-before-they-alarm.md",
    );
    const d = parseDecision(c.name!, c.text!);
    expect(d.errors).toEqual([]);
    expect(d).toMatchObject({
      status: "open",
      asked: "2026-10-06T01:37:09Z",
      from: "reddoorla/reddoor-maintenance#1199",
      refs: ["reddoorla/.github#28"],
    });
    expect(c.droppedRefs).toEqual(["roalson-interests#253", "#1190"]);
    const self = convertItem(
      { ...i87, text: `${i87.text}\nSee reddoorla/reddoor-maintenance#1199.` },
      origin,
      "b".repeat(40),
    );
    expect(pd(self.name!, self.text!).refs).toEqual(["reddoorla/.github#28"]);
    expect(d.ask).toMatch(/^Dead letters wait .* — \(a\) wait two replay cycles/);
    expect(c.text).toContain("\n## Answer\n");
    expect(convertItem(i87, { ...origin, subject: "direct push" }, "b".repeat(40)).error).toMatch(
      /names no PR/,
    );
    expect(convertItem(i87, null, "b".repeat(40)).error).toMatch(/no commit/);
  });

  it("converts only the open items of a rev, and reports the ones it cannot place", async () => {
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return ok(`${"c".repeat(40)}\n`);
      if (args[0] === "show") return ok(BACKLOG);
      if (args[0] === "log" && args[4] === "**Google Maps keys (#754)**")
        return ok(`${"f".repeat(40)}\t1789990000\tdocs: first ask (#950)\n`);
      if (args[0] === "log" && args[4]?.startsWith("**Google"))
        return ok(
          `${"d".repeat(40)}\t1790000000\tdocs: maps (#958)\n${"e".repeat(40)}\t1790000500\tlater (#960)\n`,
        );
      if (args[0] === "log") return ok("");
      throw new Error(`unexpected ${cmd}`);
    };
    const c = await convertBacklog({ rev: "origin/main" }, { run });
    expect(c.answered.map((a) => a.n)).toEqual([14, 88]);
    expect(c.converted.map((x) => x.n)).toEqual([13]);
    expect(c.converted.map((x) => x.text)[0]).toContain(
      "from: reddoorla/reddoor-maintenance#950\n",
    );
    expect(c.unparsed.map((x) => [x.n, x.error])).toEqual([
      [87, "no commit on the rev adds this item's first line"],
    ]);
    expect(formatConvert(c).split("\n")[0]).toBe(
      "CONVERT_SUMMARY rev=cccccccc items=4 answered=2 open=2 ambiguous=0 written=1 unparsed=1",
    );
    expect(c.converted.map((x) => x.originsDisagree)).toEqual([["ffffffff", "dddddddd"]]);
    expect(formatConvert(c)).toContain(
      "origin needles disagree (ffffffff, dddddddd), took the oldest",
    );
    expect(calls.filter((a) => a[0] === "log").every((a) => a.includes("c".repeat(40)))).toBe(true);
  });

  it("names a repeated item number", async () => {
    const twice = BACKLOG.replace("88. **Answered", "87. **Answered");
    const run: Runner = async (_c, args) =>
      args[0] === "rev-parse" ? ok("c".repeat(40)) : args[0] === "show" ? ok(twice) : ok("");
    const c = await convertBacklog({ rev: "x" }, { run });
    expect(c.duplicates).toEqual([{ n: 87, lines: [11, 18] }]);
    expect(formatConvert(c)).toContain("DUPLICATE item number 87 at lines 11 and 18");
  });

  it("refuses to convert into a directory that is not empty", () => {
    const d = dirWith({ "stale.md": "x" });
    const r = cli(["convert", d]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("is not empty");
  });
});

describe("directory and time edges", () => {
  it("reports every entry it will not read, instead of skipping it", () => {
    const d = dirWith({
      "2026-10-13-1200-good.md": file({}),
      "2026-10-13-1201-noext": file({}),
      "2026-10-13-1202-upper.MD": file({}),
      "_2026-10-13-1204-underscore.md": file({}),
      ".gitkeep": "",
    });
    mkdirSync(join(d, "2026-10-13-1205-sub.md"));
    const r = cli(["check", d, "--offline"]);
    expect(r.code).toBe(1);
    expect(r.out.split("\n")[0]).toBe(
      "DECISIONS_SUMMARY parsed=1 errors=4 open=1 parked=0 unchecked=0",
    );
    for (const n of [
      "2026-10-13-1201-noext",
      "2026-10-13-1202-upper.MD",
      "_2026-10-13-1204-underscore.md",
      "2026-10-13-1205-sub.md",
    ])
      expect(r.out).toContain(`ERROR ${n}: `);
    expect(r.out).toContain("ERROR 2026-10-13-1205-sub.md: not a regular file");
  });

  it("names a missing directory in one line", () => {
    const missing = join(tmpdir(), "decisions-does-not-exist-0f3a");
    const r = cli(["check", missing, "--offline"]);
    expect(r.code).toBe(1);
    expect(r.err).toBe("");
    expect(r.out).toBe(
      `DECISIONS_SUMMARY parsed=0 errors=0 open=0 parked=0 unchecked=0\nERROR ${missing}: cannot read the directory (ENOENT)\n`,
    );
    const f = join(dirWith({ "x.txt": "" }), "x.txt");
    const c = cli(["convert", f]);
    expect(c.code).toBe(2);
    expect(c.err).toBe(`decisions: ${f} is not a directory\n`);
  });

  it("rejects an asked time in the future, beyond a little clock skew", () => {
    expect(pd("2099-01-01-0000-x.md", file({}), NOW).errors).toEqual([
      "asked is in the future: 2099-01-01T00:00Z",
    ]);
    expect(pd("2026-10-13-1205-x.md", file({}), NOW).errors).toEqual([]);
    expect(pd("2026-10-13-1215-x.md", file({}), NOW).errors).toEqual([
      "asked is in the future: 2026-10-13T12:15Z",
    ]);
  });

  it("rejects a lower-case placeholder and a calendar-invalid --since", () => {
    expect(pd("2026-10-12-0900-x.md", file({ first: "todo the ask" })).errors).toEqual([
      "the ask is still the TODO placeholder",
    ]);
    expect(() => parseArgs(["list", "d", "--open", "--since", "2026-02-30T00:00Z"])).toThrow(
      "ISO time",
    );
  });

  it("never flags an ask stale on its own from PR, merged a second after the ask", async () => {
    const d = dirWith({
      "2026-10-12-1630-a.md": file({
        asked: "2026-10-12T16:30:35Z",
        from: "reddoorla/reddoor-maintenance#1301",
        refs: "[reddoorla/reddoor-maintenance#1301]",
      }),
    });
    const calls: string[] = [];
    const run: Runner = async (_c, args) => {
      calls.push(args[1] ?? "");
      return pr("2026-10-12T16:30:36Z", "2026-10-12T16:30:36Z");
    };
    const rep = await decisionsReport({ dir: d }, { now: NOW, run });
    expect(calls).toEqual([]);
    expect(formatList(rep, { open: true })).not.toContain("possibly stale");
  });

  it("prints every answered item with the marker that decided it, and demotes an open half", async () => {
    const run: Runner = async (_c, args) =>
      args[0] === "rev-parse" ? ok("c".repeat(40)) : args[0] === "show" ? ok(BACKLOG) : ok("");
    const c = await convertBacklog({ rev: "x" }, { run });
    const out = formatConvert(c);
    expect(out).toContain("- answered item 14  [decided 2026-09-29]");
    expect(out).toContain("- answered item 88  [**Answered]");
    expect(
      classifyItem("63. **Background video (answered 2026-10-01; rollout is the open half)**").kind,
    ).toBe("ambiguous");
    expect(
      classifyItem("23. **Gate** — **Answered 2026-09-30:** vida's call stays open.").kind,
    ).toBe("ambiguous");
  });
});

describe("round 3 edges", () => {
  it("takes refs from github.com URLs, and knows their repos", () => {
    const t =
      "See [caltex-landing#76](https://github.com/reddoorla/caltex-landing/pull/76) and caltex-landing#75.";
    expect(knownRepos(t).has("reddoorla/caltex-landing")).toBe(true);
    expect(extractRefs(t)).toEqual({
      refs: ["reddoorla/caltex-landing#76", "reddoorla/caltex-landing#75"],
      dropped: [],
    });
    expect(knownRepos("https://example.com/reddoorla").size).toBe(2);
    expect(extractRefs("merged in https://github.com/reddoorla/hedloc/pull/55 today")).toEqual({
      refs: ["reddoorla/hedloc#55"],
      dropped: [],
    });
  });

  it("drops a bare #N beside a repo it cannot place, rather than filing it under maintenance", () => {
    expect(extractRefs("vida#101 and #29")).toEqual({ refs: [], dropped: ["vida#101", "#29"] });
  });

  it("reads an answered marker only in the lead, not in a later sub-item", () => {
    expect(
      classifyItem(
        "90. **CalTex: Erik's fixes (new 2026-10-06).** Publish the release.\n    - (b) the logo swap: answered 2026-10-07 in Discord.",
      ),
    ).toEqual({ kind: "ambiguous", marker: "answered" });
    expect(classifyItem("90. **CalTex** — answered 2026-10-07 in Discord.").kind).toBe("answered");
  });

  it("rejects an empty ref item, a listed TODO, a comment-only ask, and answered with no answer", () => {
    expect(pd("2026-10-12-0900-x.md", file({ refs: "[a/b#1, , c/d#2]" })).errors).toEqual([
      "ref is not owner/repo#N: (empty)",
    ]);
    expect(pd("2026-10-12-0900-x.md", file({ first: "- TODO the ask" })).errors).toEqual([
      "the ask is still the TODO placeholder",
    ]);
    expect(
      pd("2026-10-12-0900-x.md", file({ first: "<!-- write the ask here -->" })).errors,
    ).toEqual(["the first line is only a comment, not the ask"]);
    expect(pd("2026-10-12-0900-x.md", file({ first: "<!-- write the ask" })).errors).toEqual([
      "the first line is only a comment, not the ask",
    ]);
    expect(pd("2026-10-12-0900-x.md", file({ status: "answered", answer: "" })).errors).toEqual([
      "status is answered but ## Answer is empty",
    ]);
    expect(
      pd(
        "2026-10-12-0900-x.md",
        file({ status: "answered" }).replace("## Answer\n", "## Answer\n\n(a), 2026-10-13.\n"),
      ).errors,
    ).toEqual([]);
  });

  it("suffixes converted names that collide", async () => {
    const twin = [
      "## Operator decisions",
      "13. **Same title** — open one.",
      "14. **Same title** — open two.",
    ].join("\n");
    const run: Runner = async (_c, args) =>
      args[0] === "rev-parse"
        ? ok("c".repeat(40))
        : args[0] === "show"
          ? ok(twin)
          : ok(`${"d".repeat(40)}\t1790000000\tdocs: x (#958)\n`);
    const c = await convertBacklog({ rev: "x" }, { run });
    expect(c.converted.map((x) => (x.name ?? "").replace(/^[\d-]+-od-/, ""))).toEqual([
      "13-same-title.md",
      "14-same-title.md",
    ]);
    const same = await convertBacklog(
      { rev: "x" },
      { run: async (cc, a) => (a[0] === "show" ? ok(twin.replace("14.", "13.")) : run(cc, a)) },
    );
    expect(same.converted.map((x) => (x.name ?? "").replace(/^[\d-]+-od-/, ""))).toEqual([
      "13-same-title.md",
      "13-same-title-2.md",
    ]);
  });

  it("prints a one-line error, not a stack, for a bad rev", () => {
    const r = cli([
      "convert",
      join(tmpdir(), `decisions-badrev-${process.pid}`),
      "--rev",
      "no-such-rev-xyz",
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^decisions: git rev-parse no-such-rev-xyz failed: /);
    expect(r.err).not.toContain("    at ");
  });
});
