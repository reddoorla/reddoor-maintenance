import { describe, it, expect } from "vitest";
import { TURNSTILE_API_JS } from "../../src/audits/form-e2e.js";

/**
 * The observation half of the Turnstile verdict had no test at all, which is how
 * #695 shipped a matcher that could never fire: `turnstileVerdict` was pinned
 * exhaustively (turnstile-verdict.test.ts) while the signal feeding its pass arm
 * was matched against a URL Cloudflare only ever answers with a 302.
 */
describe("TURNSTILE_API_JS", () => {
  it("matches the stable URL the page requests", () => {
    expect(
      TURNSTILE_API_JS.test(
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      ),
    ).toBe(true);
  });

  it("matches the build-hashed URL the 302 actually lands on", () => {
    // The 2xx only ever arrives here, so this is the case that decides whether a
    // healthy widget can earn a pass. Verbatim from reddoorla.com, 2026-09-16.
    expect(
      TURNSTILE_API_JS.test("https://challenges.cloudflare.com/turnstile/v0/g/330e41bb475c/api.js"),
    ).toBe(true);
  });

  it("does not match siteverify — that is the server-side token check, not the script", () => {
    expect(TURNSTILE_API_JS.test("https://challenges.cloudflare.com/turnstile/v0/siteverify")).toBe(
      false,
    );
  });

  it("does not match a different API version", () => {
    expect(TURNSTILE_API_JS.test("https://challenges.cloudflare.com/turnstile/v1/api.js")).toBe(
      false,
    );
  });
});
