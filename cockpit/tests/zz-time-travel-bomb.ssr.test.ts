import { expect, it } from "vitest";

// PLANTED for #1616's positive control. Never merge: this branch exists only to prove the
// time-travel workflow now sees a cockpit clock bug. The shape is the real one: a pinned
// fixture date compared against the wall clock instead of an injected `now`.
const FIXTURE_SEEN_AT = Date.parse("2026-10-21T00:00:00Z");

it("planted bomb (#1616): a fixture's age read off the wall clock stays under 30 days", () => {
  expect((Date.now() - FIXTURE_SEEN_AT) / 86_400_000).toBeLessThan(30);
});
