import { describe, it, expect } from "vitest";
import { forwardFormToWebhook, forwardNewsletterToWebhook } from "../../src/forms/webhook.js";
import { isPublicHttpsUrl } from "../../src/util/url.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

// #1970: the SSRF guard judges only the configured URL. A public https hook that
// answers 307/308 must not get the body re-POSTed to wherever its Location
// points. This stub behaves the way Node's fetch does (checked against real
// local servers, 2026-11-09): with `redirect: "manual"` it returns the 3xx;
// with anything else it follows, re-POSTing the body on a 307/308.

const HOOK = "https://hooks.zapier.com/hooks/catch/1/abc";

function redirectingFetch(location: string, code = 307) {
  const requested: string[] = [];
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    requested.push(url);
    if (url === HOOK) {
      if (init.redirect === "manual")
        return new Response(null, { status: code, headers: { location } });
      return impl(location, init);
    }
    return new Response("ok", { status: 200 });
  };
  return { impl: impl as unknown as typeof fetch, requested };
}

const FORWARDERS = {
  newsletter: forwardNewsletterToWebhook,
  form: forwardFormToWebhook,
} as const;

describe("every webhook forwarder refuses a redirect (#1970)", () => {
  for (const [name, forward] of Object.entries(FORWARDERS)) {
    for (const code of [307, 308, 302]) {
      for (const target of [
        "http://169.254.169.254/latest/meta-data",
        "https://10.0.0.5/internal",
        "http://127.0.0.1:8080/admin",
      ]) {
        it(`${name}: a ${code} to ${target} reaches only the configured hook`, async () => {
          const { impl, requested } = redirectingFetch(target, code);
          const res = await forward(HOOK, makeSubmissionRow(), makeWebsiteRow(), impl);
          expect(requested).toEqual([HOOK]);
          expect(requested.every(isPublicHttpsUrl)).toBe(true);
          expect(res).toEqual({ ok: false, status: code });
        });
      }
    }

    it(`${name}: a redirect to another PUBLIC https host is refused too`, async () => {
      // Refusal, not a per-hop guard: the forwarders never follow at all.
      const { impl, requested } = redirectingFetch("https://script.googleusercontent.com/x", 302);
      const res = await forward(HOOK, makeSubmissionRow(), makeWebsiteRow(), impl);
      expect(requested).toEqual([HOOK]);
      expect(res).toEqual({ ok: false, status: 302 });
    });
  }
});
