import { describe, expect, it } from "vitest";
import {
  QUESTION_SET_VERSION,
  questionSetFor,
  sameQuestionSet,
  ALL_GOALS,
} from "../../src/prospect/questions.js";

/**
 * The buyer questions used to be written fresh by the model on every run —
 * 6 to 10 of them, different each time. That made the Answers score unusable
 * for the one promise the report makes about it: "every number here is one we
 * can move and show you the before and after of". A denominator that moves and
 * questions that move measure a different thing each audit.
 *
 * These tests pin the property that fixes it: for a given goal, the set is
 * fixed, identified, and versioned — so two audits are comparable exactly when
 * their set ids match, and never by accident.
 */
describe("questionSetFor", () => {
  it("returns the same questions, in the same order, on every call", () => {
    const a = questionSetFor("book");
    const b = questionSetFor("book");
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id));
    expect(a.id).toBe(b.id);
  });

  it("identifies the set by goal and version, so a set change is detectable", () => {
    expect(questionSetFor("demo").id).toBe(`demo-v${QUESTION_SET_VERSION}`);
    expect(questionSetFor("book").id).not.toBe(questionSetFor("demo").id);
  });

  it("gives every goal a non-empty set with unique ids", () => {
    for (const goal of ALL_GOALS) {
      const set = questionSetFor(goal);
      expect(set.questions.length, `${goal} has questions`).toBeGreaterThan(0);
      const ids = set.questions.map((q) => q.id);
      expect(new Set(ids).size, `${goal} ids are unique`).toBe(ids.length);
    }
  });

  it("asks every buyer what it costs — the one question missing on every site we audited", () => {
    for (const goal of ALL_GOALS) {
      expect(
        questionSetFor(goal).questions.map((q) => q.id),
        `${goal} asks about cost`,
      ).toContain("cost");
    }
  });

  it("falls back to the universal questions when we could not tell what the site is for", () => {
    // Not an empty set: these questions are worth asking whether or not we know
    // the goal, and reporting nothing would look like a site that answers
    // nothing rather than an audit that did not know what to ask.
    const unknown = questionSetFor("unknown");
    const book = questionSetFor("book");
    const universal = unknown.questions.map((q) => q.id);
    expect(universal.length).toBeGreaterThan(0);
    // Every universal question also appears in a goal-specific set, so a site
    // whose goal we later learn is still asked everything it was asked before.
    for (const id of universal) expect(book.questions.map((q) => q.id)).toContain(id);
    expect(book.questions.length).toBeGreaterThan(unknown.questions.length);
  });

  it("never reuses one id for two different question texts", () => {
    const byId = new Map<string, string>();
    for (const goal of ALL_GOALS) {
      for (const q of questionSetFor(goal).questions) {
        const seen = byId.get(q.id);
        if (seen !== undefined) expect(q.question, `id ${q.id} is stable`).toBe(seen);
        byId.set(q.id, q.question);
      }
    }
  });
});

describe("sameQuestionSet", () => {
  it("is true only when two audits asked the identical set", () => {
    expect(sameQuestionSet("book-v1", "book-v1")).toBe(true);
    expect(sameQuestionSet("book-v1", "demo-v1")).toBe(false);
    expect(sameQuestionSet("book-v1", "book-v2")).toBe(false);
  });

  it("treats a missing set id as not comparable, never as a match", () => {
    // Every audit stored before this existed has no set id. Reading that as
    // "same set" would let the report claim a before/after across two
    // different measurements, which is the exact bug this replaces.
    expect(sameQuestionSet(null, null)).toBe(false);
    expect(sameQuestionSet(null, "book-v1")).toBe(false);
    expect(sameQuestionSet("book-v1", null)).toBe(false);
  });
});
