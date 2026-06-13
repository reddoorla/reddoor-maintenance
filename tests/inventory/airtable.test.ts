import { describe, it, expect, beforeEach } from "vitest";
import { fromAirtableBase } from "../../src/inventory/airtable.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

beforeEach(() => {
  delete process.env.REDDOOR_FLEET_WORKDIR;
});

describe("fromAirtableBase", () => {
  it("throws if no workdir is provided and REDDOOR_FLEET_WORKDIR isn't set", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_1",
          fields: { Name: "Acme", url: "https://acme.example.com", Status: "maintenance" },
        },
      ],
    });
    await expect(fromAirtableBase(base)()).rejects.toThrow(/workdir/);
  });

  it("returns one Site per maintenance/launch site, with deployedUrl from url and no repoUrl", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_1",
          fields: { Name: "Acme Co", url: "https://acme.example.com", Status: "maintenance" },
        },
        {
          id: "rec_2",
          fields: { Name: "Beta Corp", url: "https://beta.example.com", Status: "launch period" },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp/sites" })();
    expect(sites).toHaveLength(2);
    expect(sites[0]!.name).toBe("acme-co");
    expect(sites[0]!.path).toBe("/tmp/sites/acme-co");
    expect(sites[0]!.deployedUrl).toBe("https://acme.example.com");
    expect(sites[0]!.repoUrl).toBeUndefined(); // production URL must NOT become a clone source
    expect(sites[0]!.meta?.airtableRowId).toBe("rec_1");
    expect(sites[0]!.meta?.displayName).toBe("Acme Co");
  });

  it("excludes sites whose Status is not maintenance or launch period", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_m",
          fields: { Name: "Live", url: "https://live.example", Status: "maintenance" },
        },
        {
          id: "rec_dep",
          fields: { Name: "Old", url: "https://old.example", Status: "deprecated" },
        },
        {
          id: "rec_host",
          fields: { Name: "Hosted", url: "https://hosted.example", Status: "hosting" },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp" })();
    expect(sites.map((s) => s.name)).toEqual(["live"]);
  });

  it("excludes a maintenance site that has no url", async () => {
    const base = makeFakeBase({
      Websites: [
        { id: "rec_nourl", fields: { Name: "NoUrl", Status: "maintenance" } },
        { id: "rec_ok", fields: { Name: "Ok", url: "https://ok.example", Status: "maintenance" } },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp" })();
    expect(sites.map((s) => s.name)).toEqual(["ok"]);
  });

  it("reads workdir from REDDOOR_FLEET_WORKDIR env when no explicit option", async () => {
    process.env.REDDOOR_FLEET_WORKDIR = "/tmp/env-workdir";
    const base = makeFakeBase({
      Websites: [
        { id: "r", fields: { Name: "x", url: "https://x.example", Status: "maintenance" } },
      ],
    });
    const sites = await fromAirtableBase(base)();
    expect(sites[0]!.path).toBe("/tmp/env-workdir/x");
  });

  it("explicit workdir wins over env", async () => {
    process.env.REDDOOR_FLEET_WORKDIR = "/tmp/env-workdir";
    const base = makeFakeBase({
      Websites: [
        { id: "r", fields: { Name: "x", url: "https://x.example", Status: "maintenance" } },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp/explicit" })();
    expect(sites[0]!.path).toBe("/tmp/explicit/x");
  });

  it("skips a row whose Name has no slug-able characters (empty slug can't map back on write-back)", async () => {
    const base = makeFakeBase({
      Websites: [
        // "!!!" → siteSlug "" : un-pathable and un-matchable on write-back.
        {
          id: "rec_empty",
          fields: { Name: "!!!", url: "https://x.example", Status: "maintenance" },
        },
        {
          id: "rec_ok",
          fields: { Name: "Real Site", url: "https://real.example", Status: "maintenance" },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp" })();
    expect(sites.map((s) => s.name)).toEqual(["real-site"]);
  });

  it("drops a non-http(s) url as deployedUrl (SSRF / local-file gate) but keeps the site", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_evil",
          fields: { Name: "Evil", url: "file:///etc/passwd", Status: "maintenance" },
        },
        {
          id: "rec_bad",
          fields: { Name: "Bad", url: "notaurl", Status: "maintenance" },
        },
        {
          id: "rec_ok",
          fields: { Name: "Good Site", url: "https://good.example.com", Status: "maintenance" },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp" })();
    const byName = Object.fromEntries(sites.map((s) => [s.name, s]));
    // The site survives (it's still on the fleet) but no deployed audit target.
    expect(byName["evil"]!.deployedUrl).toBeUndefined();
    expect(byName["bad"]!.deployedUrl).toBeUndefined();
    expect(byName["good-site"]!.deployedUrl).toBe("https://good.example.com");
  });
});
