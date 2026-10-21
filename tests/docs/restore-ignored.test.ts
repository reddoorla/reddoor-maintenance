import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * `docs/runbooks/continuity.md` section 6 downloads the Turso backup into `restore/` at the repo
 * root and decrypts it there to `restore/dump.sql`: the whole fleet database in plaintext,
 * client leads included. This repository is public, so a `git add -A` in that checkout would
 * publish it (#1558). The `/restore/` line in `.gitignore` is what stops that, and this test
 * fails if it goes or stops matching the root.
 *
 * It asks git itself (`git check-ignore -v`), not the text of `.gitignore`, and requires the
 * matching rule to come from the repo's own `.gitignore`: a machine-wide ignore file on one
 * laptop would otherwise hide the line's removal there. A later `!restore/...` line re-includes the
 * dump, and `-v` still exits 0 for it, so a matching negation counts as not ignored. The negative
 * control proves the check can say "not ignored" at all; its path has no extension, so a global
 * rule such as `*.sql` cannot match it.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function checkIgnore(path: string): { ignored: boolean; source: string } {
  const r = spawnSync("git", ["check-ignore", "-v", "--no-index", path], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git check-ignore failed (${r.status}): ${r.stderr}`);
  }
  // `-v` prints `<source>:<line>:<pattern>\t<path>`, and exits 0 for a `!` negation too: the
  // last matching rule is reported whether it ignores the path or re-includes it.
  const [source = "", , pattern = ""] = r.stdout.split("\t")[0]?.split(":") ?? [];
  return { ignored: r.status === 0 && !pattern.startsWith("!"), source };
}

describe("the restore runbook's working directory", () => {
  it("negative control: a path no rule covers reads as not ignored", () => {
    expect(checkIgnore("restored/dump").ignored).toBe(false);
  });

  it.each(["restore/dump.sql", "restore/dump.sql.gpg"])(
    "%s is ignored by the repo's own .gitignore",
    (path) => {
      const r = checkIgnore(path);
      expect(
        r,
        "restore/ holds the decrypted Turso dump (continuity.md section 6); keep `/restore/` in .gitignore",
      ).toEqual({ ignored: true, source: ".gitignore" });
    },
  );
});
