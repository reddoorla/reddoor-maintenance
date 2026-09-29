import { describe, it, expect, vi, afterEach } from "vitest";
import {
  runRosterUrlsCommand,
  BOGUS_HOST_CONTROL,
  KNOWN_GOOD_CONTROL,
  type RosterUrlsDeps,
} from "../../src/cli/commands/roster-urls.js";
import type { UrlFetch } from "../../src/fleet/roster-url-probe.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-09-29T20:00:00.000Z");

function siteNotFound(): Response {
  return new Response(
    "Not Found - Request ID: 01K6A0000000000000000000ZZ\n\nBuild and deploy your own site for free: https://netlify.new/?utm_campaign=loops&utm_content=site-not-found-text",
    { status: 404, headers: { server: "Netlify", "content-type": "text/plain" } },
  );
}

const DEPLOYED_BY_HOST: Record<string, () => Response> = {
  "no-such-site-zz9q.netlify.app": siteNotFound,
  "the-pointe-burbank.netlify.app": siteNotFound,
  "the-tower-burbank-rd.netlify.app": () => new Response("<html>ok</html>", { status: 200 }),
  "ok.example.com": () => new Response("<html>ok</html>", { status: 200 }),
  "down.example.com": () => new Response("bad gateway", { status: 503 }),
};

function worldFetch(calls: string[] = []): UrlFetch {
  return async (url) => {
    calls.push(url);
    const make = DEPLOYED_BY_HOST[new URL(url).hostname];
    if (!make) {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
      });
    }
    return make();
  };
}

type Write = { siteId: string; fields: Record<string, unknown> };

function recordingMirror(writes: Write[], outcome: (id: string) => boolean | Error = () => true) {
  return async () => async (siteId: string, fields: Record<string, unknown>) => {
    const o = outcome(siteId);
    if (o instanceof Error) throw o;
    writes.push({ siteId, fields });
    return o;
  };
}

function row(id: string, url: string, status: WebsiteRow["status"]): WebsiteRow {
  return makeWebsiteRow({ id, name: id, url, status });
}

const ROSTER: WebsiteRow[] = [
  row("pointe", "https://the-pointe-burbank.netlify.app", "building"),
  row("tower", "https://the-tower-burbank-rd.netlify.app", "maintained"),
  row("ext", "https://ok.example.com", "external"),
  row("hosted", "https://down.example.com", "hosted-only"),
  row("blank", "", "external"),
  row("nostatus", "https://ok.example.com", null),
  row("weird", "https://ok.example.com", "wat" as WebsiteRow["status"]),
  row("gone", "https://the-pointe-burbank.netlify.app", "archived"),
];

function deps(over: Partial<RosterUrlsDeps> & { writes?: Write[] } = {}): Partial<RosterUrlsDeps> {
  const { writes = [], ...rest } = over;
  return {
    roster: async () => ROSTER,
    makeMirror: recordingMirror(writes),
    fetch: worldFetch(),
    now: () => NOW,
    ...rest,
  };
}

function byId(writes: Write[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(writes.map((w) => [w.siteId, w.fields]));
}

afterEach(() => vi.restoreAllMocks());

describe("runRosterUrlsCommand", () => {
  it("rejects anything but --fleet --write-back with exit 2 and touches nothing", async () => {
    const writes: Write[] = [];
    const roster = vi.fn(async () => ROSTER);
    for (const opts of [{}, { fleet: true }, { writeBack: true }]) {
      const r = await runRosterUrlsCommand(opts, deps({ writes, roster }));
      expect(r.code).toBe(2);
    }
    expect(roster).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("writes the verdict for every non-archived row, archived excluded, and names the failures", async () => {
    const writes: Write[] = [];
    const calls: string[] = [];
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({ writes, fetch: worldFetch(calls) }),
    );
    expect(r.code).toBe(0);
    const got = byId(writes);
    expect(Object.keys(got).sort()).toEqual(
      ["blank", "ext", "hosted", "nostatus", "pointe", "tower", "weird"].sort(),
    );
    expect(got.pointe).toEqual({
      "URL Resolves": "fail",
      "URL Status": "404 netlify-site-not-found",
      "URL Checked At": NOW.toISOString(),
    });
    expect(got.tower).toEqual({
      "URL Resolves": "pass",
      "URL Status": "200",
      "URL Checked At": NOW.toISOString(),
    });
    expect(got.hosted).toMatchObject({ "URL Resolves": "fail", "URL Status": "503" });
    expect(got.ext).toMatchObject({ "URL Resolves": "pass" });
    expect(got.nostatus).toMatchObject({ "URL Resolves": "pass" });
    expect(got.weird).toMatchObject({ "URL Resolves": "pass" });
    expect(r.output).toContain(
      "::warning::roster-urls: pointe https://the-pointe-burbank.netlify.app 404 netlify-site-not-found",
    );
    expect(r.output).toContain("::warning::roster-urls: hosted https://down.example.com 503");
    expect(r.output).not.toContain("::warning::roster-urls: tower");
    expect(r.output).toContain(
      "ROSTER_URL_SUMMARY checked=7 pass=4 fail=2 no_url=1 mirrored=7 mirror_failed=0",
    );
    expect(calls.filter((u) => u.includes("the-pointe-burbank"))).toHaveLength(1);
  });

  it("probes and writes a building row that the maintained-only fleet selector would skip", async () => {
    const writes: Write[] = [];
    await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({
        writes,
        roster: async () => [row("pointe", "https://the-pointe-burbank.netlify.app", "building")],
      }),
    );
    expect(byId(writes).pointe).toMatchObject({ "URL Resolves": "fail" });
  });

  it("an archived row is neither probed nor written", async () => {
    const writes: Write[] = [];
    const calls: string[] = [];
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({
        writes,
        fetch: worldFetch(calls),
        roster: async () => [row("gone", "https://ok.example.com/archived-only", "archived")],
      }),
    );
    expect(writes).toEqual([]);
    expect(calls.some((u) => u.includes("archived-only"))).toBe(false);
    expect(r.output).toContain("ROSTER_URL_SUMMARY checked=0 ");
  });

  it("a blank url stores NULL / no url, stamped like every other row", async () => {
    const writes: Write[] = [];
    await runRosterUrlsCommand({ fleet: true, writeBack: true }, deps({ writes }));
    expect(byId(writes).blank).toEqual({
      "URL Resolves": null,
      "URL Status": "no url",
      "URL Checked At": NOW.toISOString(),
    });
  });

  it("stamps url_checked_at with the run's time on every outcome", async () => {
    const writes: Write[] = [];
    await runRosterUrlsCommand({ fleet: true, writeBack: true }, deps({ writes }));
    expect(writes).toHaveLength(7);
    for (const w of writes) expect(w.fields["URL Checked At"]).toBe(NOW.toISOString());
  });

  it("with no network, the known-good control fails: nothing written, exit 1, the control named", async () => {
    const writes: Write[] = [];
    const roster = vi.fn(async () => ROSTER);
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({
        writes,
        roster,
        fetch: async () => {
          throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
        },
      }),
    );
    expect(r.code).toBe(1);
    expect(writes).toEqual([]);
    expect(roster).not.toHaveBeenCalled();
    expect(r.output).toContain("::error::");
    expect(r.output).toContain(KNOWN_GOOD_CONTROL.url);
    expect(r.output).toContain("error: ECONNREFUSED");
  });

  it("behind a proxy that answers 200 to everything, the bogus-host control fails: nothing written, exit 1", async () => {
    const writes: Write[] = [];
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({ writes, fetch: async () => new Response("captive portal", { status: 200 }) }),
    );
    expect(r.code).toBe(1);
    expect(writes).toEqual([]);
    expect(r.output).toContain("::error::");
    expect(r.output).toContain(BOGUS_HOST_CONTROL.url);
    expect(r.output).toContain("pass 200");
  });

  it("a control that reads a plain 404 instead of site-not-found also stops the run", async () => {
    const writes: Write[] = [];
    const base = worldFetch();
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({
        writes,
        fetch: async (url, init) =>
          url.includes("no-such-site-zz9q")
            ? new Response("<html>", { status: 404, headers: { server: "Netlify" } })
            : base(url, init),
      }),
    );
    expect(r.code).toBe(1);
    expect(writes).toEqual([]);
  });

  it("exits 1 when mirror failures outnumber writes, and counts a 0-row update as a failure", async () => {
    const writes: Write[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({
        makeMirror: recordingMirror(writes, (id) =>
          id === "tower" || id === "ext" ? true : id === "blank" ? false : new Error("libsql down"),
        ),
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("mirrored=2 mirror_failed=5");
  });

  it("exits 0 when only a minority of mirror writes fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({
        makeMirror: recordingMirror([], (id) => (id === "tower" ? new Error("flake") : true)),
      }),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("mirrored=6 mirror_failed=1");
  });

  it("a run with no store is exit 1 and says why", async () => {
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({ makeMirror: async () => null }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("::error::roster-urls: no store");
  });

  it("a known-good control that answers but not 2xx stops the run", async () => {
    const writes: Write[] = [];
    const base = worldFetch();
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({
        writes,
        fetch: async (url, init) =>
          url.includes("the-tower-burbank-rd")
            ? new Response("unavailable", { status: 503 })
            : base(url, init),
      }),
    );
    expect(r.code).toBe(1);
    expect(writes).toEqual([]);
    expect(r.output).toContain(`known-good control ${KNOWN_GOOD_CONTROL.url} read fail 503`);
  });

  it("an equal split of mirror writes and failures is not a majority: exit 0", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({
        roster: async () => [
          row("tower", "https://the-tower-burbank-rd.netlify.app", "maintained"),
          row("ext", "https://ok.example.com", "external"),
        ],
        makeMirror: recordingMirror([], (id) => (id === "ext" ? new Error("flake") : true)),
      }),
    );
    expect(r.output).toContain("mirrored=1 mirror_failed=1");
    expect(r.code).toBe(0);
  });

  it("a roster with nothing to probe is a clean run", async () => {
    const r = await runRosterUrlsCommand(
      { fleet: true, writeBack: true },
      deps({ roster: async () => [row("gone", "https://ok.example.com", "archived")] }),
    );
    expect(r.code).toBe(0);
  });

  it("warns once per failing row and never for a blank url", async () => {
    const r = await runRosterUrlsCommand({ fleet: true, writeBack: true }, deps());
    const warnings = r.output.split("\n").filter((l) => l.startsWith("::warning::"));
    expect(warnings).toHaveLength(2);
    expect(r.output).not.toContain("::warning::roster-urls: blank");
  });
});
