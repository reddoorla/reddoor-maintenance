import { describe, expect, it } from "vitest";
import {
  classifyDomains,
  phonesOn,
  sameSite,
  type OwnershipDeps,
} from "../../src/prospect/ownership.js";

const deps = (pages: Record<string, { finalUrl?: string; body: string }>): OwnershipDeps => ({
  async fetchPage(url) {
    const hit = pages[url];
    if (!hit) return null;
    return { finalUrl: hit.finalUrl ?? url, body: hit.body };
  },
});

describe("phonesOn", () => {
  it("reads a tel: link", () => {
    expect([...phonesOn('<a href="tel:+1-310-378-9241">Call</a>')]).toContain("3103789241");
  });

  it("reads a number written as text", () => {
    expect([...phonesOn("<p>Call us on (310) 378-9241 today</p>")]).toContain("3103789241");
  });

  it("finds nothing in a page with no number", () => {
    expect(phonesOn("<p>Hello</p>").size).toBe(0);
  });
});

describe("sameSite", () => {
  it("treats a subdomain as the same site", () => {
    expect(sameSite("www.example.com", "example.com")).toBe(true);
    expect(sameSite("example.com", "www.example.com")).toBe(true);
  });

  it("does not confuse a suffix for a subdomain", () => {
    expect(sameSite("notexample.com", "example.com")).toBe(false);
  });
});

describe("classifyDomains — platforms", () => {
  it("names a directory as a listing site without fetching it", async () => {
    // yelp.com answers an automated request with 403, so probing it would fill
    // the report with "we could not tell" about the sources that matter most.
    // It is also not a question a fetch can answer: no page tells you Yelp is a
    // directory.
    let fetched = false;
    const [v] = await classifyDomains("https://x.com", ["3103789241"], ["yelp.com"], {
      fetchPage: async () => {
        fetched = true;
        return null;
      },
    });
    expect(v?.owner).toBe("platform");
    expect(fetched).toBe(false);
  });

  it("matches a platform subdomain", async () => {
    const [v] = await classifyDomains("https://x.com", [], ["reviews.birdeye.com"], {
      fetchPage: async () => null,
    });
    expect(v?.owner).toBe("platform");
  });
});

describe("classifyDomains", () => {
  const PHONES = ["3103789241"];

  it("recognises the prospect's own domain without a fetch", () => {
    return classifyDomains(
      "https://beachfrontdentistry.com",
      PHONES,
      ["beachfrontdentistry.com"],
      deps({}),
    ).then(([v]) => expect(v?.owner).toBe("yours"));
  });

  it("recognises an old site of theirs by its phone number", async () => {
    // The real case. dochopkins.com is Beachfront's own former site, still up,
    // and an engine cited it four times against one citation of the current
    // one. Reading it as a third party turned the best finding in the report
    // into a false statement about the client's own business.
    const [v] = await classifyDomains(
      "https://beachfrontdentistry.com",
      PHONES,
      ["dochopkins.com"],
      {
        ...deps({
          "https://dochopkins.com/": {
            body: '<a href="tel:310-378-9241">Call the office</a>',
          },
        }),
      },
    );
    expect(v?.owner).toBe("yours");
    expect(v?.because).toContain("same phone number");
  });

  it("recognises an old domain that redirects", async () => {
    const [v] = await classifyDomains(
      "https://beachfrontdentistry.com",
      PHONES,
      ["olddomain.com"],
      {
        ...deps({
          "https://olddomain.com/": {
            finalUrl: "https://beachfrontdentistry.com/",
            body: "<p>Welcome</p>",
          },
        }),
      },
    );
    expect(v?.owner).toBe("yours");
    expect(v?.because).toContain("redirects");
  });

  it("calls an unrelated site theirs", async () => {
    // A competitor's practice, not a directory: reachable, real, and sharing
    // nothing with the prospect.
    const [v] = await classifyDomains(
      "https://beachfrontdentistry.com",
      PHONES,
      ["someotherdds.com"],
      {
        ...deps({ "https://someotherdds.com/": { body: "<p>Call us on 415-908-3801</p>" } }),
      },
    );
    expect(v?.owner).toBe("theirs");
  });

  it("says unknown rather than guessing when the domain will not load", async () => {
    const [v] = await classifyDomains(
      "https://beachfrontdentistry.com",
      PHONES,
      ["gone.com"],
      deps({}),
    );
    expect(v?.owner).toBe("unknown");
    expect(v?.because).toContain("could not reach");
  });

  it("says unknown when we have no phone of our own to compare", async () => {
    // No signal is not a negative signal. Reporting "someone else's" off a
    // comparison we could not make is the error this module exists to stop.
    const [v] = await classifyDomains("https://beachfrontdentistry.com", [], ["dochopkins.com"], {
      ...deps({ "https://dochopkins.com/": { body: "<p>An old site</p>" } }),
    });
    expect(v?.owner).toBe("unknown");
    expect(v?.because).toContain("no phone number");
  });

  it("classifies each domain once, however many times it was cited", async () => {
    const out = await classifyDomains(
      "https://beachfrontdentistry.com",
      PHONES,
      ["someotherdds.com", "someotherdds.com", "someotherdds.com"],
      { ...deps({ "https://someotherdds.com/": { body: "<p>A practice</p>" } }) },
    );
    expect(out).toHaveLength(1);
  });
});
