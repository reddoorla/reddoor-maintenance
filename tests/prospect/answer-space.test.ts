import { describe, it, expect } from "vitest";
import {
  analyzeAnswerSpace,
  normalizeDomain,
  ownHost,
  type AnswerSpace,
} from "../../src/prospect/answer-space.js";
import type { ProbeAnswer } from "../../src/prospect/types.js";

function answer(partial: Partial<ProbeAnswer> & { citedDomains: string[] }): ProbeAnswer {
  return {
    engine: "test",
    query: "q",
    kind: "category",
    domainCited: false,
    brandMentioned: false,
    snippet: "",
    truncated: false,
    askedAt: "2026-08-26T00:00:00.000Z",
    ...partial,
  };
}

describe("normalizeDomain", () => {
  it("strips a leading www. so one source does not rank as two", () => {
    expect(normalizeDomain("www.Example.com")).toBe("example.com");
    expect(normalizeDomain("example.com")).toBe("example.com");
  });

  it("leaves other subdomains alone — a blog really is a different source", () => {
    expect(normalizeDomain("blog.example.com")).toBe("blog.example.com");
  });
});

describe("ownHost", () => {
  it("returns the bare host", () => {
    expect(ownHost("https://www.Example.com/about")).toBe("example.com");
  });

  it("returns null rather than throwing on an unparseable url", () => {
    expect(ownHost("not a url")).toBeNull();
  });
});

describe("analyzeAnswerSpace", () => {
  it("counts citations with repeats but domains without", () => {
    const space = analyzeAnswerSpace(
      [answer({ citedDomains: ["a.com", "a.com", "b.com"] })],
      "https://mine.com",
    );
    expect(space.citationsTotal).toBe(3);
    expect(space.distinctDomains).toBe(2);
    expect(space.topSources.at(0)).toEqual({ domain: "a.com", count: 2, share: 2 / 3 });
  });

  it("ignores branded and competitor answers", () => {
    // Branded queries hand the engine the name, so they describe nothing about
    // how the category is answered — including them would inflate every share
    // with citations the prospect's own name produced.
    const space = analyzeAnswerSpace(
      [
        answer({ kind: "branded", citedDomains: ["brandonly.com"] }),
        answer({ kind: "competitor", citedDomains: ["headtohead.com"] }),
        answer({ kind: "category", citedDomains: ["real.com"] }),
      ],
      "https://mine.com",
    );
    expect(space.distinctDomains).toBe(1);
    expect(space.topSources.at(0)?.domain).toBe("real.com");
    expect(space.queriesAsked).toBe(1);
  });

  it("counts a query that cited nothing as asked but not as an answer", () => {
    // An engine that declines to cite anything is a fact about the query, not
    // about the prospect. Folding it into the shares would dilute them with
    // silence; dropping it from queriesAsked would hide that we asked.
    const space = analyzeAnswerSpace(
      [answer({ citedDomains: [] }), answer({ citedDomains: ["a.com"] })],
      "https://mine.com",
    );
    expect(space.queriesAsked).toBe(2);
    expect(space.answersWithCitations).toBe(1);
  });

  it("finds how many domains cover half the citations", () => {
    // 4 + 3 + 2 + 1 = 10 citations. a.com alone is 4 (not half); a+b is 7,
    // which crosses 5. So two domains cover half.
    const space = analyzeAnswerSpace(
      [
        answer({
          citedDomains: [
            "a.com",
            "a.com",
            "a.com",
            "a.com",
            "b.com",
            "b.com",
            "b.com",
            "c.com",
            "c.com",
            "d.com",
          ],
        }),
      ],
      "https://mine.com",
    );
    expect(space.citationsTotal).toBe(10);
    expect(space.domainsToHalf).toBe(2);
  });

  it("ranks the prospect's own domain and ignores www when matching", () => {
    const space = analyzeAnswerSpace(
      [answer({ citedDomains: ["big.com", "big.com", "www.mine.com"] })],
      "https://mine.com/services",
    );
    expect(space.ownDomainRank).toBe(2);
    expect(space.ownDomainCount).toBe(1);
  });

  it("names the top source that is NOT the prospect", () => {
    // Answers "on the searches we ran, who came back instead of you" — and
    // nothing stronger. Measured top-rival shares on the 12-site benchmark are
    // 4-16%, so this is NOT the owner of a category and the report must never
    // present it as one; see the field comment in answer-space.ts.
    const space = analyzeAnswerSpace(
      [answer({ citedDomains: ["mine.com", "mine.com", "mine.com", "rival.com"] })],
      "https://mine.com",
    );
    expect(space.ownDomainRank).toBe(1);
    expect(space.topRival).toEqual({ domain: "rival.com", count: 1, share: 0.25 });
  });

  it("reports no rival when the prospect is the only cited source", () => {
    const space = analyzeAnswerSpace([answer({ citedDomains: ["mine.com"] })], "https://mine.com");
    expect(space.topRival).toBeNull();
  });

  it("breaks count ties by domain, so the named rival is stable across runs", () => {
    // Without the tiebreak these rank by Map insertion order, and the report
    // would name a different "top rival" for identical data depending on which
    // query happened to run first.
    const forward = analyzeAnswerSpace(
      [answer({ citedDomains: ["zebra.com", "apple.com"] })],
      "https://mine.com",
    );
    const reversed = analyzeAnswerSpace(
      [answer({ citedDomains: ["apple.com", "zebra.com"] })],
      "https://mine.com",
    );
    expect(forward.topSources.at(0)?.domain).toBe("apple.com");
    expect(reversed.topSources.at(0)?.domain).toBe("apple.com");
  });

  it("takes the lower median width on an even count", () => {
    // The report quotes this as "half the answers drew on N sources or fewer",
    // which an interpolated 2.5 cannot mean.
    const space = analyzeAnswerSpace(
      [
        answer({ citedDomains: ["a.com", "b.com"] }),
        answer({ citedDomains: ["c.com", "d.com", "e.com"] }),
      ],
      "https://mine.com",
    );
    expect(space.medianWidthPerAnswer).toBe(2);
  });

  it("survives an unparseable prospect url without losing the rest", () => {
    const space = analyzeAnswerSpace([answer({ citedDomains: ["a.com"] })], "not a url");
    expect(space.ownDomainRank).toBeNull();
    expect(space.distinctDomains).toBe(1);
    expect(space.topRival?.domain).toBe("a.com");
  });

  it("returns an empty, non-null-crashing shape when nothing was cited at all", () => {
    const space: AnswerSpace = analyzeAnswerSpace([], "https://mine.com");
    expect(space.citationsTotal).toBe(0);
    expect(space.distinctDomains).toBe(0);
    expect(space.domainsToHalf).toBeNull();
    expect(space.medianWidthPerAnswer).toBeNull();
    expect(space.ownDomainRank).toBeNull();
    expect(space.topRival).toBeNull();
  });
});
