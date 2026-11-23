import { describe, it, expect } from "vitest";
import {
  BacklogParseError,
  firstSentence,
  refsIn,
  splitRow,
  topBacklogItems,
} from "../../src/dashboard/backlog.js";

/**
 * P1-111. The fixture is invented: the real BACKLOG.md lives in a private repo
 * and this one is public, so none of its text may be committed here. It copies
 * the real file's shapes instead: the header's re-rank line, the P1 table with
 * a seven-cell header row, rows of five and one cell, a status line prepended
 * over an older one so a `**` is left unpaired, a pipe inside a code span, and
 * a heading after the table.
 */
const ROWS = {
  a: "| P1-901 | **Paint the fence (NEW 2026-11-20): two coats, west side first.** Context. | 🟢 | S | [M] evidence | Start here. | Done when dry. |",
  b: "| P1-902 | **Status 2026-11-21 [M, merged PRs]: reddoorla/reddoor-maintenance#2010 closed #1755; reddoorla/reddoor-website#340 closed #893. More after.** Status 2026-11-19 [M]: older text (#1995).** **Fix the gate latch, ranked by the 11-20 pass** rest of cell. | mixed | S to L | ev | start | done |",
  c: "| P1-903 | **Water the beds `a | b` at dawn** | 🟡 who waters | M | ev | start | done |",
  d: "| P1-904 | **Prune the hedge.** **Status 2026-11-22: not a prefix, so not read.** | 🟡 | M | ev | start |",
  e: "| P1-905 | **Mend the shed roof** 🟡 (tier written in the item cell) [M] effort M. |",
  f: "| P1-906 | **Sweep the path** | 🟢 | S | ev | start | done |",
};

function backlog(
  rows: string[],
  header = "**Last full re-rank: 2026-11-23 ~13:20Z** (state updated later)",
) {
  return [
    "# Backlog — a fixture",
    "",
    header,
    "",
    "## P0 — today",
    "",
    "| not | this | table |",
    "| --- | --- | --- |",
    "| P1-999 | **Never read: P0 is above the P1 heading** | 🟢 |",
    "",
    "## P1 — next",
    "",
    "| # | Item | Tier | Effort | Start here | Done when |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "### Blocked behind another PR",
    "",
    "| P1-950 | **Not in the table above** | 🟢 |",
  ].join("\n");
}

const ALL = [ROWS.a, ROWS.b, ROWS.c, ROWS.d, ROWS.e, ROWS.f];

describe("topBacklogItems", () => {
  it("returns the first five P1 rows in file order, ranked 1 to 5", () => {
    const top = topBacklogItems(backlog(ALL));
    expect(top.items.map((i) => [i.rank, i.id])).toEqual([
      [1, "P1-901"],
      [2, "P1-902"],
      [3, "P1-903"],
      [4, "P1-904"],
      [5, "P1-905"],
    ]);
  });

  it("follows a re-rank: two rows swapped swap their ranks", () => {
    const top = topBacklogItems(backlog([ROWS.c, ROWS.b, ROWS.a, ROWS.d, ROWS.e, ROWS.f]));
    expect(top.items.map((i) => i.id)).toEqual(["P1-903", "P1-902", "P1-901", "P1-904", "P1-905"]);
  });

  it("a row moved up from sixth enters the five and pushes the fifth out", () => {
    const top = topBacklogItems(backlog([ROWS.f, ROWS.a, ROWS.b, ROWS.c, ROWS.d, ROWS.e]));
    expect(top.items.map((i) => i.id)).toEqual(["P1-906", "P1-901", "P1-902", "P1-903", "P1-904"]);
  });

  it("returns every row when the table has fewer than five", () => {
    expect(topBacklogItems(backlog([ROWS.a, ROWS.f])).items.map((i) => i.id)).toEqual([
      "P1-901",
      "P1-906",
    ]);
  });

  it("reads the header's re-rank time", () => {
    expect(topBacklogItems(backlog(ALL)).rerankedAt).toBe("2026-11-23T13:20:00.000Z");
    expect(
      topBacklogItems(backlog(ALL, "**Last full re-rank: 2026-11-02 ~9:05Z**")).rerankedAt,
    ).toBe("2026-11-02T09:05:00.000Z");
    expect(topBacklogItems(backlog(ALL, "No rank line.")).rerankedAt).toBeNull();
  });

  it("takes the bold lead as the title, markdown stripped, and the tier cell as written", () => {
    const [a, , c] = topBacklogItems(backlog(ALL)).items;
    expect(a!.title).toBe("Paint the fence (NEW 2026-11-20): two coats, west side first.");
    expect(a!.tier).toBe("🟢");
    expect(a!.status).toBeNull();
    // The pipe inside the code span splits no cell.
    expect(c!.title).toBe("Water the beds a | b at dawn");
    expect(c!.tier).toBe("🟡 who waters");
  });

  it("peels status prefixes off the title, even with an unpaired ** left between them", () => {
    const b = topBacklogItems(backlog(ALL)).items[1]!;
    expect(b.title).toBe("Fix the gate latch, ranked by the 11-20 pass");
    expect(b.tier).toBe("mixed");
    expect(b.status).toEqual({
      date: "2026-11-21",
      sentence:
        "reddoorla/reddoor-maintenance#2010 closed #1755; reddoorla/reddoor-website#340 closed #893.",
      refs: [
        {
          label: "reddoorla/reddoor-maintenance#2010",
          href: "https://github.com/reddoorla/reddoor-maintenance/issues/2010",
        },
        { label: "#1755", href: "https://github.com/reddoorla/reddoor-maintenance/issues/1755" },
        {
          label: "reddoorla/reddoor-website#340",
          href: "https://github.com/reddoorla/reddoor-website/issues/340",
        },
        // A bare number is maintenance's, even after another repo was named.
        { label: "#893", href: "https://github.com/reddoorla/reddoor-maintenance/issues/893" },
      ],
    });
  });

  it("picks the newest status by date, not by position", () => {
    const row =
      "| P1-907 | **Status 2026-11-01: older first.** **Status 2026-11-15: newer second (#12).** **Title** | 🟢 |";
    const it7 = topBacklogItems(backlog([row])).items[0]!;
    expect(it7.status?.date).toBe("2026-11-15");
    expect(it7.status?.sentence).toBe("newer second (#12).");
    expect(it7.title).toBe("Title");
  });

  it("reads a bold Status line later in the cell as text, not as a status prefix", () => {
    const d = topBacklogItems(backlog(ALL)).items[3]!;
    expect(d.title).toBe("Prune the hedge.");
    expect(d.status).toBeNull();
  });

  it("reads a title that only begins with the word Status as a title", () => {
    const row = "| P1-909 | **Status page for clients** | 🟢 |";
    const it9 = topBacklogItems(backlog([row])).items[0]!;
    expect(it9.title).toBe("Status page for clients");
    expect(it9.status).toBeNull();
  });

  it("gives a one-cell row a null tier rather than failing", () => {
    const e = topBacklogItems(backlog(ALL)).items[4]!;
    expect(e.title).toBe("Mend the shed roof");
    expect(e.tier).toBeNull();
  });

  describe("fails loudly, naming the row and never quoting it", () => {
    const cases: Array<[string, string, RegExp]> = [
      [
        "a status with no date",
        "| P1-908 | **Status: shipped.** **Title** | 🟢 |",
        /^P1-908: .*YYYY-MM-DD/,
      ],
      [
        "a status with a US date",
        "| P1-908 | **Status 11-23-2026 shipped.** **Title** | 🟢 |",
        /^P1-908: /,
      ],
      [
        "a status with an impossible date",
        "| P1-908 | **Status 2026-13-40: x.** **Title** | 🟢 |",
        /^P1-908: /,
      ],
      [
        "a status with nothing after its date",
        "| P1-908 | **Status 2026-11-20 [M]:** **Title** | 🟢 |",
        /^P1-908: .*no text/,
      ],
      [
        "a status that never closes",
        "| P1-908 | **Status 2026-11-20: open bold, no title | 🟢 |",
        /^P1-908: .*no bold title/,
      ],
      ["no bold title", "| P1-908 | Plain title | 🟢 |", /^P1-908: .*no bold title/],
      ["no ID", "| | **Title** | 🟢 |", /^line \d+: .*P1-NNN/],
    ];
    for (const [name, row, message] of cases) {
      it(name, () => {
        let caught: unknown;
        try {
          topBacklogItems(backlog([ROWS.a, row]));
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(BacklogParseError);
        const msg = (caught as Error).message;
        expect(msg).toMatch(message);
        expect(msg).not.toMatch(/Title|shipped|open bold/);
      });
    }

    it("no P1 heading", () => {
      expect(() => topBacklogItems("# Backlog\n\n## P0\n")).toThrow(BacklogParseError);
    });

    it("a P1 heading with no table before the next heading", () => {
      expect(() =>
        topBacklogItems("## P1 — next\n\nprose\n\n### Blocked\n| P1-1 | **x** |"),
      ).toThrow(/no table/);
    });

    it("a table with no separator row", () => {
      expect(() => topBacklogItems(`## P1\n\n| # | Item |\n${ROWS.a}\n`)).toThrow(/separator/);
    });
  });
});

describe("splitRow", () => {
  it("splits on pipes outside code spans and escapes", () => {
    expect(splitRow("| a | `b | c` | d \\| e |")).toEqual(["a", "`b | c`", "d | e"]);
  });
});

describe("firstSentence", () => {
  it("stops at the first full stop that ends a word, outside brackets and code", () => {
    expect(firstSentence("Moves 4.2.0 to `x. y` (see a. b) on reddoorla.com. Then more.")).toBe(
      "Moves 4.2.0 to `x. y` (see a. b) on reddoorla.com.",
    );
    expect(firstSentence("No full stop at all")).toBe("No full stop at all");
  });
});

describe("refsIn", () => {
  it("dedupes and leaves anchors and paths alone", () => {
    expect(
      refsIn("#12 and #12, a/b#3, see file.md#section and a/b/c#4").map((r) => r.label),
    ).toEqual(["#12", "a/b#3"]);
  });
});
