import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `docs/workJournal.md` was frozen on 2026-10-07. New entries are one file each in
 * `docs/journal/`, because one shared file conflicted: the journal was in 183 of the 230
 * conflicted merges from `main` in the week after 2026-09-29, and agents resolved them by hand
 * (2026-10-06 review). A session that still appends here, from habit or an old brief, would
 * bring the conflicts back without anyone noticing, so this test fails on any change.
 *
 * The one edit the frozen file may take is a forward pointer, a line starting
 * `> Superseded` under an old entry's heading (CLAUDE.md, "The work journal"). The digest
 * drops those lines and collapses the blank lines they leave behind, so adding a pointer keeps
 * it green and anything else turns it red.
 */

const JOURNAL = join(fileURLToPath(new URL(".", import.meta.url)), "../../docs/workJournal.md");
const FROZEN_SHA256 = "ea28562354efde637461f30e22a7faacc2f5322e20d1f08166a9a2de75834aee";

function frozenDigest(text: string): string {
  const kept = text
    .split("\n")
    .filter((line) => !line.startsWith("> Superseded"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return createHash("sha256").update(kept).digest("hex");
}

describe("frozenDigest", () => {
  const base = "# Journal\n\n## 2026-09-01 — An entry\n\nWhat was done and why.\n";

  it("is unchanged by a forward pointer under an old heading", () => {
    const pointed = base.replace(
      "## 2026-09-01 — An entry\n",
      "## 2026-09-01 — An entry\n\n> Superseded in part by 2026-10-09 — A later entry.\n",
    );
    expect(pointed).not.toBe(base);
    expect(frozenDigest(pointed)).toBe(frozenDigest(base));
  });

  it("changes when an entry is appended", () => {
    const appended = `${base}\n## 2026-10-08 — A new entry in the old file\n\nIt belongs in docs/journal/.\n`;
    expect(frozenDigest(appended)).not.toBe(frozenDigest(base));
  });

  it("changes when an old entry is edited in place", () => {
    expect(frozenDigest(base.replace("and why", "and how"))).not.toBe(frozenDigest(base));
  });
});

describe("docs/workJournal.md", () => {
  it("is frozen: new entries go to docs/journal/, one file each", () => {
    expect(
      frozenDigest(readFileSync(JOURNAL, "utf8")),
      "docs/workJournal.md changed. Write the entry as a new file in docs/journal/ instead; the only edit this file may take is a '> Superseded' pointer.",
    ).toBe(FROZEN_SHA256);
  });
});
