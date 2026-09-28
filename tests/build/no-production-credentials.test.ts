import { describe, it, expect } from "vitest";
import { CREDENTIAL_ENV } from "../../vitest.credential-env.js";

describe("the suite never sees production credentials", () => {
  it("strips every credential variable before a test runs, as CI never sets them", () => {
    expect(Object.keys(process.env).filter((name) => CREDENTIAL_ENV.test(name))).toEqual([]);
  });

  it("covers the stores a test could write to", () => {
    for (const name of [
      "TURSO_DATABASE_URL",
      "TURSO_AUTH_TOKEN",
      "TURSO_FLEET_USAGE",
      "AIRTABLE_PAT",
      "AIRTABLE_BASE_ID",
      "RESEND_API_KEY",
      "PRISMIC_WRITE_TOKEN",
      "NETLIFY_PAT",
      "GH_TOKEN",
    ]) {
      expect(CREDENTIAL_ENV.test(name), name).toBe(true);
    }
    expect(CREDENTIAL_ENV.test("PATH")).toBe(false);
    expect(CREDENTIAL_ENV.test("REDDOOR_TIME_TRAVEL_DAYS")).toBe(false);
  });
});
