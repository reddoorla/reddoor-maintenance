import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stepEnv, stepRunScript } from "../build/_helpers/workflow-source.js";

// The staging-flow template every fleet repo copies to .github/workflows/main-gate.yml.
// The test runs its `run:` block byte for byte, with `gh` and `sleep` faked, so the
// gate GitHub runs is the gate tested here.
const TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/runbooks/staging-flow/main-gate.yml",
);
const STEP = "Only staging, or a Renovate patch or minor, may merge into main";
const BOT = "reddoor-renovate[bot]";
const BRANCH = "renovate/main-npm-vite-vulnerability";
const BASE = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";

const created = `branch_creation ${BOT} ${HEAD}`;
const PASS = `main-gate: ${BOT} patch or minor on ${BRANCH}.`;
const UNREAD = `main-gate: could not read who pushed to ${BRANCH}.`;

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/**
 * Run the gate on a fast-track Renovate PR whose head is HEAD and whose every
 * other check passes. `feed[i]` is what the activity feed answers on read i+1
 * (newest first, `<type> <actor> <after>` per line, "" for nothing); the last
 * answer repeats. That is the 2026-10-21 race on
 * reddoorla/la-homelessness-initiative#65: the feed listed nothing 22 to 24
 * seconds after Renovate created the branch.
 */
function runGate(feed: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "main-gate-"));
  roots.push(dir);
  const log = join(dir, "calls.log");
  const reads = join(dir, "activity-reads");
  feed.forEach((answer, i) => writeFileSync(join(dir, `feed-${i + 1}`), answer));
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  stub("sleep", `printf 'sleep %s\\n' "$1" >> "${log}"`);
  // gh applies --jq itself, so the fake answers with what the --jq would print.
  stub(
    "gh",
    `path=""
for a in "$@"; do case "$a" in repos/*) path="$a" ;; esac; done
case "$path" in
  */pulls/*/commits) echo "abc1234 ${BOT} web-flow true" ;;
  */activity\\?*)
    n=$(( $(cat "${reads}" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "${reads}"
    printf 'gh activity read %s\\n' "$n" >> "${log}"
    i=$(( n < ${feed.length} ? n : ${feed.length} ))
    [ -s "${dir}/feed-$i" ] && cat "${dir}/feed-$i" && echo
    ;;
  */pulls/*/files) printf 'package.json\\npnpm-lock.yaml\\n' ;;
  */issues/*/labels) echo "fast-track" ;;
  */issues/*/events) echo "${BOT}" ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
exit 0`,
  );
  const script = join(dir, "step.sh");
  writeFileSync(script, stepRunScript(readFileSync(TEMPLATE, "utf-8"), STEP));
  const r = spawnSync("bash", ["--noprofile", "--norc", script], {
    encoding: "utf-8",
    timeout: 20_000,
    env: {
      PATH: `${dir}:/usr/bin:/bin`,
      GH_TOKEN: "x",
      REPO: "reddoorla/la-homelessness-initiative",
      PR: "65",
      HEAD_REF: BRANCH,
      HEAD_SHA: HEAD,
      HEAD_REPO: "reddoorla/la-homelessness-initiative",
      AUTHOR: BOT,
    },
  });
  const calls = existsSync(log)
    ? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean)
    : [];
  return {
    code: r.status,
    out: r.stdout + r.stderr,
    reads: calls.filter((c) => c.startsWith("gh activity read")).length,
    slept: calls
      .filter((c) => c.startsWith("sleep "))
      .reduce((sum, c) => sum + Number(c.slice(6)), 0),
  };
}

describe("main-gate — reading who pushed to a fresh Renovate branch", () => {
  it("passes when the first read reaches the head, without waiting", () => {
    const r = runGate([created]);
    expect(r.out).toContain(PASS);
    expect(r.code).toBe(0);
    expect(r.reads).toBe(1);
    expect(r.slept).toBe(0);
  });

  it("passes when the feed is empty for three reads and then reaches the head", () => {
    const r = runGate(["", "", "", created]);
    expect(r.out).toContain(PASS);
    expect(r.code).toBe(0);
    expect(r.reads).toBe(4);
    expect(r.slept).toBe(2 + 4 + 8);
  });

  it("still fails closed when the feed never lists the branch: six reads, 60 s", () => {
    const r = runGate([""]);
    expect(r.out).toContain(UNREAD);
    expect(r.code).toBe(1);
    expect(r.reads).toBe(6);
    expect(r.slept).toBe(60);
  });

  it("does not trust a feed that lists the creation but not the stranger's push to the head", () => {
    // Renovate created the branch at BASE; someone else pushed HEAD (bot as
    // author, signed by GitHub) before Renovate opened the PR. A lagging feed
    // shows the creation alone first.
    const partial = `branch_creation ${BOT} ${BASE}`;
    const full = `push someone-else ${HEAD}\n${partial}`;
    const r = runGate(["", partial, partial, full]);
    expect(r.reads).toBe(4);
    expect(r.out).toContain("was also pushed to by: someone-else");
    expect(r.code).toBe(1);
  });

  it("still fails closed when the feed reaches the head but never lists the creation", () => {
    const r = runGate([`push ${BOT} ${HEAD}`]);
    expect(r.out).toContain(UNREAD);
    expect(r.code).toBe(1);
    expect(r.reads).toBe(6);
  });

  it("still fails a branch someone else created", () => {
    const r = runGate([`push ${BOT} ${HEAD}\nbranch_creation someone-else ${BASE}`]);
    expect(r.out).toContain("was also pushed to by: someone-else");
    expect(r.code).toBe(1);
  });

  it("reads back only to the latest creation, because Renovate reuses branch names", () => {
    const r = runGate([
      `${created}\npush someone-else ${BASE}\nbranch_creation someone-else ${BASE}`,
    ]);
    expect(r.out).toContain(PASS);
    expect(r.code).toBe(0);
  });

  it("reads a reused branch's long history without dying of SIGPIPE", () => {
    // About 1.2 MB behind the latest creation: an awk that stops there must not
    // kill its writer under pipefail. `printf | awk` died here from somewhere
    // between 180 KB and 600 KB (measured 2026-10-21).
    const old = Array.from({ length: 20_000 }, () => `push someone-else ${BASE}`).join("\n");
    const r = runGate([`${created}\n${old}`]);
    expect(r.out).toContain(PASS);
    expect(r.code).toBe(0);
  });

  it("takes HEAD_SHA from the PR's head commit", () => {
    // The tests above inject HEAD_SHA; this pins where the workflow gets it.
    const env = stepEnv(readFileSync(TEMPLATE, "utf-8"), STEP);
    expect(env["HEAD_SHA"]).toBe("${{ github.event.pull_request.head.sha }}");
  });
});
