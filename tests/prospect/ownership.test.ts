import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyDomains,
  defaultOwnershipDeps,
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

describe("phonesOn — a number in prose next to another number", () => {
  // The exact shape consistency.ts replaced its own loose digit run over: a
  // greedy match swallows the street/suite number sitting beside the phone and
  // reports one number as a different, longer one. Here that costs more than a
  // duplicate finding — the number no longer matches the prospect's, so their
  // own abandoned domain gets classified as somebody else's website.
  it("reads the phone number, not the phone number welded to the street number", () => {
    const found = [...phonesOn("<p>Beachfront Dentistry (310) 378-9241 1706 S Catalina Ave</p>")];
    expect(found).toContain("3103789241");
    expect(found).not.toContain("31037892411706");
  });

  it("does not read a street number followed by a zip as a phone number", () => {
    expect([...phonesOn("<p>1706 S Catalina Ave, Redondo Beach 90277</p>")]).toEqual([]);
  });
});

describe("classifyDomains — a shared number written as prose", () => {
  it("does not call the client's own abandoned site somebody else's", async () => {
    const [v] = await classifyDomains(
      "https://beachfrontdentistry.com",
      ["3103789241"],
      ["dochopkins.com"],
      deps({
        "https://dochopkins.com/": {
          body: "<p>Dr Hopkins DDS (310) 378-9241 1706 S Catalina Ave, Redondo Beach</p>",
        },
      }),
    );
    expect(v?.owner).toBe("yours");
  });
});

describe("classifyDomains — addresses we refuse to fetch", () => {
  // Every domain here was named by an answer engine, and this runs on a private
  // runner holding Turso, Discord and API credentials. crawl.ts was hardened
  // against exactly this in PR #618; this fetcher was the one that was not.
  const PRIVATE = [
    "127.0.0.1",
    "localhost",
    "foo.localhost",
    "10.0.0.5",
    "192.168.1.10",
    "172.16.4.4",
    "169.254.169.254",
    "100.64.1.1",
    "[::1]",
  ];

  it("never fetches a private, loopback or link-local address", async () => {
    const asked: string[] = [];
    const out = await classifyDomains("https://acme.example", ["3103789241"], PRIVATE, {
      fetchPage: async (url) => {
        asked.push(url);
        return { finalUrl: url, body: "<p>310-378-9241</p>" };
      },
    });
    expect(asked).toEqual([]);
    expect(out.map((v) => v.owner)).toEqual(PRIVATE.map(() => "unknown"));
    for (const v of out) expect(v.because).toMatch(/did not|not fetch|internal|private/i);
  });

  // A publicly routable literal is still not a website a business owns, and an
  // engine naming one is a model artefact rather than a citation.
  it("never fetches a bare IP literal, routable or not", async () => {
    const asked: string[] = [];
    const [v] = await classifyDomains("https://acme.example", ["3103789241"], ["8.8.8.8"], {
      fetchPage: async (url) => {
        asked.push(url);
        return { finalUrl: url, body: "<p>310-378-9241</p>" };
      },
    });
    expect(asked).toEqual([]);
    expect(v?.owner).toBe("unknown");
  });

  it("does not read a body that came back from a private address after a redirect", async () => {
    const [v] = await classifyDomains(
      "https://acme.example",
      ["3103789241"],
      ["redirector.example"],
      {
        fetchPage: async () => ({
          finalUrl: "http://169.254.169.254/latest/meta-data/",
          body: "<p>Call 310-378-9241</p>",
        }),
      },
    );
    expect(v?.owner).toBe("unknown");
  });
});

describe("defaultOwnershipDeps — redirects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not follow a redirect onto a private address", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return {
          ok: false,
          status: 302,
          url,
          headers: {
            get: (n: string) => (n.toLowerCase() === "location" ? "http://127.0.0.1/" : null),
          },
          async text() {
            throw new Error("must not read a body from a refused hop");
          },
        };
      }) as unknown as typeof fetch,
    );

    const deps = defaultOwnershipDeps("test-agent");
    await expect(deps.fetchPage("https://redirector.example/")).resolves.toBeNull();
    expect(asked.some((u) => u.includes("127.0.0.1"))).toBe(false);
  });

  it("follows an ordinary redirect and reports where it landed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://old.example/") {
          return {
            ok: false,
            status: 301,
            url,
            headers: {
              get: (n: string) =>
                n.toLowerCase() === "location" ? "https://new.example/home" : null,
            },
            async text() {
              return "";
            },
          };
        }
        return {
          ok: true,
          status: 200,
          url,
          headers: { get: () => null },
          async text() {
            return "<p>Welcome</p>";
          },
        };
      }) as unknown as typeof fetch,
    );

    const deps = defaultOwnershipDeps("test-agent");
    await expect(deps.fetchPage("https://old.example/")).resolves.toEqual({
      finalUrl: "https://new.example/home",
      body: "<p>Welcome</p>",
    });
  });
});
