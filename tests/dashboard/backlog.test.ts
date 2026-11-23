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

  it("reads a status later in the item cell, after the title", () => {
    const d = topBacklogItems(backlog(ALL)).items[3]!;
    expect(d.title).toBe("Prune the hedge.");
    expect(d.status).toEqual({
      date: "2026-11-22",
      sentence: "not a prefix, so not read.",
      refs: [],
    });
  });

  describe("reads statuses from every cell, the newest by date winning (the operator, 2026-11-23, answer (b))", () => {
    it("a status in another column, whose bold holds only the label", () => {
      const row =
        "| P1-911 | **Rake the leaves** | 🟢 | S | Begin at the gate. **Status 2026-11-01:** the rake is in the shed (#77). More. | done |";
      const item = topBacklogItems(backlog([row])).items[0]!;
      expect(item.title).toBe("Rake the leaves");
      expect(item.status).toEqual({
        date: "2026-11-01",
        sentence: "the rake is in the shed (#77).",
        refs: [
          { label: "#77", href: "https://github.com/reddoorla/reddoor-maintenance/issues/77" },
        ],
      });
    });

    it("a newer status in another column beats an older item-cell prefix", () => {
      const row =
        "| P1-912 | **Status 2026-11-02: older.** **Title** | 🟢 | S | ev | **Status 2026-11-20 [M]: newer.** | done |";
      expect(topBacklogItems(backlog([row])).items[0]!.status?.sentence).toBe("newer.");
    });

    it("an older status in another column loses to a newer item-cell prefix", () => {
      const row =
        "| P1-913 | **Status 2026-11-20: newer.** **Title** | 🟢 | S | ev | Status 2026-11-02: older. | done |";
      expect(topBacklogItems(backlog([row])).items[0]!.status?.sentence).toBe("newer.");
    });

    it("two statuses in one cell are two lines, each ending where the next begins", () => {
      const row =
        "| P1-914 | **Title** | 🟢 | S | Status 2026-11-03: first #1 Status 2026-11-04: second #2 | done |";
      const status = topBacklogItems(backlog([row])).items[0]!.status!;
      expect(status.date).toBe("2026-11-04");
      expect(status.sentence).toBe("second #2");
      expect(status.refs.map((r) => r.label)).toEqual(["#2"]);
    });

    it("a second status inside a prefix is read, and the newer wins", () => {
      const row = "| P1-916 | **Status 2026-11-01 old. Status 2026-11-22 new.** **Title** | 🟢 |";
      const status = topBacklogItems(backlog([row])).items[0]!.status!;
      expect([status.date, status.sentence]).toEqual(["2026-11-22", "new."]);
    });

    it("a prefix whose bold holds only its label keeps the text after it", () => {
      const row = "| P1-917 | **Status 2026-11-22:** done (#4). **Title** | 🟢 |";
      const item = topBacklogItems(backlog([row])).items[0]!;
      expect(item.title).toBe("Title");
      expect(item.status?.sentence).toBe("done (#4).");
      expect(item.status?.refs.map((r) => r.label)).toEqual(["#4"]);
    });

    it("a status bolded with underscores in another column", () => {
      const row = "| P1-918 | **Title** | 🟢 | S | __Status 2026-11-22__ x. | done |";
      expect(topBacklogItems(backlog([row])).items[0]!.status?.sentence).toBe("x.");
    });

    it("a lone backtick splits no fewer cells", () => {
      const row = "| P1-919 | **Title** run the ` flag | 🟢 | S | ev | done |";
      expect(topBacklogItems(backlog([row])).items[0]!.tier).toBe("🟢");
    });

    it("a bold inside a label-only prefix's text is part of its sentence, not the title", () => {
      const row =
        "| P1-920 | **Status 2026-11-22:** done, see **P1-82** first. **Real title** | 🟢 | S | ev | done |";
      const item = topBacklogItems(backlog([row])).items[0]!;
      expect(item.title).toBe("Real title");
      expect(item.status?.sentence).toBe("done, see P1-82 first.");
    });

    it("when two statuses share a date, the first met wins", () => {
      const row =
        "| P1-921 | **Status 2026-11-22: first.** **Title** | 🟢 | S | Status 2026-11-22: second. | done |";
      expect(topBacklogItems(backlog([row])).items[0]!.status?.sentence).toBe("first.");
    });
  });

  describe("reads markdown code and emphasis the way GitHub shows them (round 7)", () => {
    const one = (row: string) => topBacklogItems(backlog([row])).items[0]!;

    it("a lone backtick joins no columns, even when a later column has a code span", () => {
      const item = one(
        "| P1-930 | **Title** it's a ` tick | 🟢 | S | Status 2026-11-22 ran `x`. | done |",
      );
      expect(item.tier).toBe("🟢");
      expect(item.status?.sentence).toBe("ran x.");
    });

    it("an escaped backtick opens no code span", () => {
      expect(one("| P1-931 | **Title** a \\` b | 🟢 | S | run `x` | done |").tier).toBe("🟢");
    });

    it("a double-backtick code span holding a pipe stays one cell", () => {
      const item = one("| P1-932 | **Title** run ``a|b`` now | 🟢 | S | ev | done |");
      expect(item.tier).toBe("🟢");
    });

    it("** inside a code span is not bold, in a title, a sentence or a prefix", () => {
      expect(one("| P1-933 | **Lint `src/**/*.ts` files** then more | 🟢 |").title).toBe(
        "Lint src/**/*.ts files",
      );
      expect(
        one("| P1-933 | **Title** | 🟢 | S | Status 2026-11-22 ran `src/**` clean. | done |").status
          ?.sentence,
      ).toBe("ran src/** clean.");
      const prefixed = one(
        "| P1-933 | **Status 2026-11-22 ran `src/**` clean.** **Real title** | 🟢 |",
      );
      expect(prefixed.title).toBe("Real title");
      expect(prefixed.status?.sentence).toBe("ran src/** clean.");
    });

    it("a lone backtick does not swallow the following sentences", () => {
      expect(
        one(
          "| P1-934 | **Title** | 🟢 | S | Status 2026-11-22 the ` key is set. Then more. | done |",
        ).status?.sentence,
      ).toBe("the ` key is set.");
    });

    it("single emphasis and strikethrough are stripped, snake_case is kept", () => {
      expect(
        one(
          "| P1-935 | **Title** | 🟢 | S | Status 2026-11-22 *shipped* ~~not~~ site_fields _now_. | done |",
        ).status?.sentence,
      ).toBe("shipped not site_fields now.");
      expect(one("| P1-935 | ***Title*** | 🟢 |").title).toBe("Title");
    });
  });

  describe("reads statuses from every cell (continued)", () => {
    it("a word that only contains status is not one", () => {
      const row = "| P1-915 | **Title** statuses noted | 🟢 | S | Statuses wait. | done |";
      expect(topBacklogItems(backlog([row])).items[0]!.status).toBeNull();
    });
  });

  it("keeps a leading link's text in the sentence, and drops a dash after the date", () => {
    const link = "| P1-910 | **Status 2026-11-20 [PR](https://x.example/1) merged.** **T** | 🟢 |";
    expect(topBacklogItems(backlog([link])).items[0]!.status?.sentence).toBe("PR merged.");
    const dash = "| P1-910 | **Status 2026-11-20 — merged #5.** **T** | 🟢 |";
    expect(topBacklogItems(backlog([dash])).items[0]!.status?.sentence).toBe("merged #5.");
  });

  it("refuses a title that begins with the word Status, but not one that only contains it", () => {
    expect(() =>
      topBacklogItems(backlog(["| P1-909 | **Status page for clients** | 🟢 |"])),
    ).toThrow(/^P1-909: its title begins with the word Status/);
    const ok = topBacklogItems(backlog(["| P1-909 | **Statuses and a status page** | 🟢 |"]));
    expect(ok.items[0]!.title).toBe("Statuses and a status page");
  });

  it("gives a one-cell row a null tier rather than failing", () => {
    const e = topBacklogItems(backlog(ALL)).items[4]!;
    expect(e.title).toBe("Mend the shed roof");
    expect(e.tier).toBeNull();
  });

  describe("fails loudly, naming the row and never quoting it", () => {
    const cases: Array<[string, string, RegExp]> = [
      [
        "a lower-case status",
        "| P1-908 | **status 2026-11-11: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with no space before its date",
        "| P1-908 | **Status2026-11-11: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with a dash before its date",
        "| P1-908 | **Status-2026-11-20: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with its date in parentheses",
        "| P1-908 | **Status (2026-11-20): shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with four spaces before its date",
        "| P1-908 | **Status    2026-11-20: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with an underscore before its date",
        "| P1-908 | **Status_2026-11-20: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with its tag before its date",
        "| P1-908 | **Status [M] 2026-11-20: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with a tag and no date",
        "| P1-908 | **Status [M]: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with a month name",
        "| P1-908 | **Status Nov 12: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a struck-through status",
        "| P1-908 | **~~Status 2026-11-19: shipped.~~** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "an italic status",
        "| P1-908 | **_Status 2026-11-20_: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status in a code span",
        "| P1-908 | **`Status 2026-11-01`: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status as a link",
        "| P1-908 | **[Status 2026-11-01](http://x.example): shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status in an HTML tag",
        "| P1-908 | **<s>Status 2026-11-01: shipped.</s>** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status behind a zero-width space",
        "| P1-908 | **\u200bStatus 2026-11-01: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
      [
        "a status with junk after its date",
        "| P1-908 | **Status 2026-11-11-x: shipped.** **Title** | 🟢 |",
        /^P1-908: .*Status/,
      ],
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
      [
        "a lower-case status in another column",
        "| P1-908 | **Title** | 🟢 | S | status 2026-11-11: shipped. | done |",
        /^P1-908: column 5 .*Status YYYY-MM-DD/,
      ],
      [
        "a struck-through status in another column",
        "| P1-908 | **Title** | 🟢 | S | ~~Status 2026-11-11: shipped.~~ | done |",
        /^P1-908: column 5 /,
      ],
      [
        "a status in a code span in another column",
        "| P1-908 | **Title** | 🟢 | S | `Status 2026-11-11`: shipped. | done |",
        /^P1-908: column 5 /,
      ],
      [
        "a status with no space before its date in another column",
        "| P1-908 | **Title** | 🟢 | S | ev | Status2026-11-11: shipped. |",
        /^P1-908: column 6 /,
      ],
      [
        "a status with a month name in another column",
        "| P1-908 | **Title** | 🟢 | S | **Status Nov 12:** shipped. | done |",
        /^P1-908: column 5 /,
      ],
      [
        "a status with an impossible date in another column",
        "| P1-908 | **Title** | 🟢 | S | Status 2026-13-40: shipped. | done |",
        /^P1-908: column 5 /,
      ],
      [
        "a status with nothing after its date in another column",
        "| P1-908 | **Title** | 🟢 | S | **Status 2026-11-11:** | done |",
        /^P1-908: .*no text/,
      ],
      [
        "the word status in prose in another column",
        "| P1-908 | **Title** | 🟢 | S | Check the status of it, shipped. | done |",
        /^P1-908: column 5 /,
      ],
      [
        "a malformed status in the item cell after the title",
        "| P1-908 | **Title** then Status: shipped. | 🟢 |",
        /^P1-908: column 2 /,
      ],
      [
        "a lower-case status inside a prefix",
        "| P1-908 | **Status 2026-11-01 blocked; status 2026-11-22 shipped.** **Title** | 🟢 |",
        /^P1-908: column 2 /,
      ],
      [
        "an impossible date for a second status inside a prefix",
        "| P1-908 | **Status 2026-11-01 a. Status 2026-13-45 shipped.** **Title** | 🟢 |",
        /^P1-908: column 2 /,
      ],
      [
        "a struck status inside a prefix",
        "| P1-908 | **Status 2026-11-01 x <s>status 2026-11-22</s> shipped.** **Title** | 🟢 |",
        /^P1-908: column 2 /,
      ],
      [
        "a lone backtick before a malformed status names the status's own column",
        "| P1-908 | **Title** a ` b | 🟢 | S | status 2026-11-22 shipped. | done |",
        /^P1-908: column 5 /,
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
