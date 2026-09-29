import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import config from "../../vitest.config.js";
import { CREDENTIAL_ENV, stripCredentials } from "../../vitest.credential-env.js";
import { defaultCredentialsPath, loadCredentialsIntoEnv } from "../../src/util/credentials.js";

const credentialKeys = () => Object.keys(process.env).filter((name) => CREDENTIAL_ENV.test(name));

describe("the suite never sees production credentials", () => {
  it("runs the strip before every test file", () => {
    expect(config.test?.setupFiles).toContain("./vitest.no-credentials-setup.ts");
  });

  it("removes every credential variable and points the config dir at an empty one", () => {
    const env: Record<string, string | undefined> = {
      TURSO_DATABASE_URL: "libsql://CANARY.turso.io",
      RESEND_API_KEY: "re_CANARY",
      GH_TOKEN: "ghp_CANARY",
      PATH: "/usr/bin",
      XDG_CONFIG_HOME: "/home/operator/.config",
    };
    stripCredentials(env, "/tmp/empty-config");
    expect(env).toEqual({ PATH: "/usr/bin", XDG_CONFIG_HOME: "/tmp/empty-config" });
  });

  it("leaves this worker, and any CLI it spawns, nothing to load", () => {
    expect(credentialKeys()).toEqual([]);
    expect(existsSync(defaultCredentialsPath())).toBe(false);
    loadCredentialsIntoEnv();
    expect(credentialKeys()).toEqual([]);
  });

  it("covers the stores a test could write to", () => {
    for (const name of [
      "TURSO_DATABASE_URL",
      "TURSO_AUTH_TOKEN",
      "TURSO_FLEET_USAGE",
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
