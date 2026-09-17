import { describe, it, expect } from "vitest";
import { RETIRED_FLAGS, rewriteRetiredFlags } from "../../src/cli/retired-flags.js";

// #698: `--write-airtable` was renamed `--write-back` because the old name stated
// the store it wrote to, and agents believed it. The old spelling is still typed
// by runbooks, shell history and anything outside this repo, so it keeps working
// by being rewritten BEFORE cac parses — cac has no hidden-option support, and a
// second registered `.option()` would advertise the retired name in `--help`.
describe("rewriteRetiredFlags", () => {
  const argv = (...rest: string[]) => ["node", "reddoor-maint", ...rest];

  it("rewrites the bare retired flag to its new name, and says so once", () => {
    const notes: string[] = [];
    const out = rewriteRetiredFlags(argv("audit", "--write-airtable", "--only", "x"), (m) =>
      notes.push(m),
    );
    expect(out).toEqual(argv("audit", "--write-back", "--only", "x"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("--write-airtable");
    expect(notes[0]).toContain("--write-back");
  });

  // `audit --write-airtable=<slug>` is the single-site form; the value must survive.
  it("keeps an =value attached", () => {
    const out = rewriteRetiredFlags(argv("audit", "--write-airtable=caltex"), () => {});
    expect(out).toEqual(argv("audit", "--write-back=caltex"));
  });

  // The control: an argv with nothing retired comes back unchanged and silent,
  // or the assertions above prove nothing about the rewrite being targeted.
  it("leaves every other token alone, and prints nothing", () => {
    const notes: string[] = [];
    const input = argv("audit", "--write-back", "--fleet", "airtable", "--write-airtable-ish");
    expect(rewriteRetiredFlags(input, (m) => notes.push(m))).toEqual(input);
    expect(notes).toEqual([]);
  });

  // Everything after `--` is a positional, not an option, by POSIX convention.
  it("does not rewrite past the -- terminator", () => {
    const input = argv("audit", "--", "--write-airtable");
    expect(rewriteRetiredFlags(input, () => {})).toEqual(input);
  });

  it("does not rewrite the program path or script path", () => {
    const input = ["--write-airtable", "--write-airtable", "audit"];
    expect(rewriteRetiredFlags(input, () => {}).slice(0, 2)).toEqual(input.slice(0, 2));
  });

  it("maps only to flags that are not themselves retired", () => {
    for (const next of Object.values(RETIRED_FLAGS)) {
      expect(Object.keys(RETIRED_FLAGS)).not.toContain(next);
    }
  });
});
