import { describe, expect, it } from "vitest";
import {
  probeForms,
  INVALID_EMAIL,
  type FormProbe,
  type InteractionDeps,
} from "../../src/prospect/interaction.js";
import { runSiteChecks } from "../../src/prospect/site-checks.js";
import type { CrawlResult } from "../../src/prospect/types.js";

/** What the page reports back, scripted per call so a test can say "the form
 *  was clean before the click and complaining after it". */
type State = { nativeInvalid: boolean; flagged: number; hasErrorText: boolean };
const clean: State = { nativeInvalid: false, flagged: 0, hasErrorText: false };

function fake(
  opts: {
    /** null means the page has no form worth pressing. */
    form?: { fields: number; hasEmail: boolean; action: string } | null;
    /** One entry per READ_STATE call, in order. */
    states?: (State | null)[];
    /** Requests the interceptor stops, per click. */
    blocksPerClick?: number;
    clickThrows?: boolean;
    fillFails?: boolean;
    /** The page did not come back with a form on it after the reload. */
    reloadLosesForm?: boolean;
  } = {},
) {
  const {
    form = { fields: 4, hasEmail: true, action: "/enquiry" },
    states = [],
    blocksPerClick = 0,
    clickThrows = false,
    fillFails = false,
    reloadLosesForm = false,
  } = opts;

  let stateCall = 0;
  let blocked = 0;
  const log: string[] = [];
  let released = false;

  const deps: InteractionDeps = {
    url: "https://acme.example/contact",
    settle: async () => {},
    async evaluate<T>(fn: string): Promise<T> {
      if (fn.includes("bestScore")) {
        log.push("choose");
        return form as T;
      }
      if (fn.includes("selectedIndex")) {
        log.push("fill");
        return !fillFails as T;
      }
      log.push("read");
      // NOT `?? clean` — a scripted `null` means "the form is gone", which is
      // a state this module reads differently from a clean one.
      const i = stateCall++;
      return (i < states.length ? states[i] : clean) as T;
    },
    async clickSubmit() {
      log.push("click");
      if (clickThrows) throw new Error("element is not visible");
      blocked += blocksPerClick;
    },
    async intercept() {
      log.push("armed");
      return {
        blocked: () => blocked,
        reload: async () => {
          log.push("reload");
          return !reloadLosesForm;
        },
        release: async () => {
          released = true;
          log.push("released");
        },
      };
    },
  };
  return { deps, log, wasReleased: () => released };
}

describe("nothing we do reaches their server", () => {
  it("arms the interceptor before it touches anything, and always lets go", async () => {
    // The order is the safety argument. A click before `armed` is a real
    // enquiry in a stranger's inbox.
    const { deps, log, wasReleased } = fake({ states: [clean, clean] });
    await probeForms(deps);
    expect(log.indexOf("armed")).toBeLessThan(log.indexOf("click"));
    expect(wasReleased()).toBe(true);
  });

  it("lets go even when the click throws", async () => {
    const { deps, wasReleased } = fake({ clickThrows: true });
    const probe = await probeForms(deps);
    expect(wasReleased()).toBe(true);
    // And says nothing about the form, because nothing was learned.
    expect(probe?.emptyRefused).toBeUndefined();
  });

  it("reports what the interceptor stopped, so the claim is checkable", async () => {
    const { deps } = fake({ blocksPerClick: 1, states: [clean, clean] });
    const probe = await probeForms(deps);
    expect(probe?.blocked).toBeGreaterThan(0);
  });

  it("does not press anything when there is no enquiry form", async () => {
    const { deps, log } = fake({ form: null });
    expect(await probeForms(deps)).toBeNull();
    expect(log).toEqual(["choose"]);
  });
});

describe("an empty submission", () => {
  it("is refused without a click when the browser already says the form is invalid", async () => {
    // `required` on any field makes the form report itself invalid before
    // anything happens. Clicking would only make the browser say so aloud.
    const { deps, log } = fake({ states: [{ ...clean, nativeInvalid: true }] });
    const probe = await probeForms(deps);
    expect(probe?.emptyRefused).toBe(true);
    expect(probe?.emptyHow).toMatch(/browser blocks it/);
    // One click at most, and it belongs to the email pass — not to this one.
    expect(log.slice(0, log.indexOf("fill")).filter((l) => l === "click")).toEqual([]);
  });

  it("is caught when the form tries to send with every field empty", async () => {
    const { deps } = fake({ blocksPerClick: 1, states: [clean, clean] });
    const probe = await probeForms(deps);
    expect(probe?.emptyRefused).toBe(false);
    expect(probe?.emptyHow).toMatch(/submitted with every field empty/);
  });

  it("passes a form that paints its own error instead of submitting", async () => {
    const { deps } = fake({
      blocksPerClick: 0,
      states: [clean, { ...clean, hasErrorText: true }],
    });
    const probe = await probeForms(deps);
    expect(probe?.emptyRefused).toBe(true);
    expect(probe?.emptyHow).toMatch(/showed an error/);
  });

  it("catches the button that does nothing at all", async () => {
    // Nothing sent and nothing said is the same experience as a form that
    // swallows the message, and it is invisible in the markup.
    const { deps } = fake({ blocksPerClick: 0, states: [clean, clean] });
    const probe = await probeForms(deps);
    expect(probe?.emptyRefused).toBe(false);
    expect(probe?.emptyHow).toMatch(/did nothing at all/);
  });

  it("says nothing when the form left the page under us", async () => {
    const { deps } = fake({ states: [clean, null] });
    const probe = await probeForms(deps);
    expect(probe?.emptyRefused).toBeUndefined();
  });
});

describe("an address that is not an address", () => {
  it("is not asked about when the form wants no email", async () => {
    const { deps } = fake({
      form: { fields: 2, hasEmail: false, action: "/x" },
      states: [{ ...clean, nativeInvalid: true }],
    });
    const probe = await probeForms(deps);
    expect(probe?.invalidEmailRefused).toBeNull();
  });

  it("is refused by the browser when the field is typed as an email", async () => {
    const { deps } = fake({
      states: [
        { ...clean, nativeInvalid: true },
        { ...clean, nativeInvalid: true },
      ],
    });
    const probe = await probeForms(deps);
    expect(probe?.invalidEmailRefused).toBe(true);
    expect(probe?.invalidEmailHow).toMatch(/typed as an email/);
  });

  it("is caught when the form sends it anyway", async () => {
    const { deps } = fake({
      blocksPerClick: 1,
      states: [{ ...clean, nativeInvalid: true }, clean, clean],
    });
    const probe = await probeForms(deps);
    expect(probe?.invalidEmailRefused).toBe(false);
    expect(probe?.invalidEmailHow).toContain(INVALID_EMAIL);
  });

  it("starts from a clean copy of the page, never the one it just clicked", async () => {
    // Both reasons at once: a form that accepted the empty submit is gone (the
    // aborted navigation leaves the browser on its own error page), and a form
    // that painted "please enter a valid email" still has that text on screen —
    // reading it after the second click credits the form with catching
    // something it never saw.
    const { deps, log } = fake({
      blocksPerClick: 1,
      states: [clean, clean, clean, clean],
    });
    await probeForms(deps);
    expect(log.indexOf("reload")).toBeGreaterThan(log.indexOf("click"));
    expect(log.indexOf("reload")).toBeLessThan(log.indexOf("fill"));
  });

  it("is unmeasured when the reload does not bring the form back", async () => {
    const { deps } = fake({ reloadLosesForm: true, states: [{ ...clean, nativeInvalid: true }] });
    const probe = await probeForms(deps);
    expect(probe?.invalidEmailRefused).toBeUndefined();
  });

  it("is unmeasured when we could not fill the form", async () => {
    const { deps } = fake({ fillFails: true, states: [{ ...clean, nativeInvalid: true }] });
    const probe = await probeForms(deps);
    expect(probe?.invalidEmailRefused).toBeUndefined();
  });
});

describe("the checks these produce", () => {
  const crawlWith = (formProbe: FormProbe | null): CrawlResult =>
    ({
      origin: "https://acme.example",
      robotsTxt: null,
      agentAccess: [],
      sitemap: { present: false, urlCount: 0, sample: [] },
      llmsTxt: { present: false, firstLine: null },
      sidecarErrors: { robots: null, llms: null, sitemap: null },
      homeHeaders: {},
      pages: [
        {
          url: "https://acme.example/contact",
          status: 200,
          raw: null,
          rendered: null,
          error: null,
          formProbe,
        },
      ],
    }) as unknown as CrawlResult;

  const keyed = (probe: FormProbe | null, key: string) =>
    runSiteChecks(crawlWith(probe), null).find((c) => c.key === key);

  it("sits out entirely when the site has no enquiry form", () => {
    const c = keyed(null, "form-rejects-empty");
    expect(c?.status).toBe("not-applicable");
    expect(c?.evidence).toMatch(/no enquiry form/);
  });

  it("turns a form that submits empty into a failure with the reason attached", () => {
    const c = keyed(
      {
        url: "https://acme.example/contact",
        emptyRefused: false,
        emptyHow: "the form submitted with every field empty",
        invalidEmailRefused: true,
        invalidEmailHow: "x",
        blocked: 1,
      },
      "form-rejects-empty",
    );
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toMatch(/every field empty/);
  });

  it("never turns a form we could not reach into a failure", () => {
    // A cross-origin form, or a control we could not click. Our gap.
    const c = keyed(
      {
        url: "https://acme.example/contact",
        emptyRefused: undefined,
        emptyHow: null,
        invalidEmailRefused: undefined,
        invalidEmailHow: null,
        blocked: 0,
      },
      "form-rejects-empty",
    );
    expect(c?.status).toBe("unmeasured");
  });

  it("keeps 'this form asks for no email' out of the denominator", () => {
    const c = keyed(
      {
        url: "https://acme.example/contact",
        emptyRefused: true,
        emptyHow: "x",
        invalidEmailRefused: null,
        invalidEmailHow: null,
        blocked: 0,
      },
      "form-rejects-bad-email",
    );
    expect(c?.status).toBe("not-applicable");
  });
});
