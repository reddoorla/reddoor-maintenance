import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { stepEnv, stepRunScript, workflowPath, workflowSteps } from "./_helpers/workflow-source.js";
import { contentHash, run } from "../../scripts/dropbox.mjs";

const execFileAsync = promisify(execFile);

/**
 * OD 97(g): one copy a month of the ENCRYPTED nightly dump goes to Dropbox
 * `/Reddoor/Backups/turso/turso-YYYY-MM.sql.gpg`, kept indefinitely, so the
 * backup no longer lives only in a 30-day Actions artifact.
 *
 * Two steps, both EXTRACTED FROM THE YAML AND EXECUTED against stubs:
 * - "Decide the monthly Dropbox copy" says whether tonight copies: the first
 *   of the UTC month, or a dispatch with `dropbox_copy: true`, and only when
 *   the three Dropbox secrets are set (otherwise a warning naming them).
 * - "Copy the encrypted dump to Dropbox" uploads `dump.sql.gpg` under the
 *   month's name and passes only on `dropbox.mjs`'s own hash-match line.
 *
 * The copy is continue-on-error and runs after the artifact upload, so a
 * Dropbox failure never turns the backup red; it files its own issue.
 */

const DECIDE = "Decide the monthly Dropbox copy";
const COPY = "Copy the encrypted dump to Dropbox";
const FOLDER = "/Reddoor/Backups/turso";
const SECRETS = {
  DROPBOX_APP_KEY: "k",
  DROPBOX_APP_SECRET: "s",
  DROPBOX_REFRESH_TOKEN: "r",
};
const NO_SECRETS = { DROPBOX_APP_KEY: "", DROPBOX_APP_SECRET: "", DROPBOX_REFRESH_TOKEN: "" };
const CIPHERTEXT = "-----CIPHERTEXT dump.sql.gpg-----\n";
const PLAINTEXT = "INSERT INTO sites (id) VALUES ('recA');\n";
const TEAM_ACCOUNT =
  "account: Ada Example <ada@example.com>, team Example Team, root namespace 1111111111 (team space)";
const PERSONAL_ACCOUNT =
  "account: Ada Example <ada@example.com>, root namespace 1 (personal space: the root is the home folder)";
const okLine = (path: string, data: string) =>
  `ok ${path} ${Buffer.byteLength(data)} bytes content_hash ${contentHash(Buffer.from(data))} matches local`;

let wf: string;
let decide: string;
let copy: string;

beforeAll(async () => {
  wf = await readFile(workflowPath("fleet-db-backup.yml"), "utf-8");
  decide = stepRunScript(wf, DECIDE);
  copy = stepRunScript(wf, COPY);
});

interface Ran {
  code: number;
  out: string;
  outputs: Record<string, string>;
  /** Each `node` invocation's argv, and the bytes of every file it was handed. */
  nodeCalls: string[][];
  uploaded: Record<string, string>;
}

async function runStep(
  script: string,
  opts: { day?: string; month?: string; env?: Record<string, string>; dropboxOut?: string },
): Promise<Ran> {
  const dir = await mkdtemp(join(tmpdir(), "db-backup-dropbox-"));
  const bin = join(dir, "bin");
  const sent = join(dir, "sent");
  await mkdir(bin);
  await mkdir(sent);
  await writeFile(join(dir, "dump.sql.gpg"), CIPHERTEXT, "utf-8");
  // A plaintext dump left beside the ciphertext, so a step that picked the
  // wrong file would upload these bytes and the test would see them.
  await writeFile(join(dir, "dump.sql"), PLAINTEXT, "utf-8");
  await writeFile(join(dir, "dropbox.txt"), opts.dropboxOut ?? "", "utf-8");
  await writeFile(join(dir, "GITHUB_OUTPUT"), "", "utf-8");
  // `node scripts/dropbox.mjs upload <folder> <file…>`: log argv, keep a copy of
  // every file argument's bytes, print the canned output.
  await writeFile(
    join(bin, "node"),
    `#!/bin/bash
{ printf '%s\\037' "$@"; printf '\\036'; } >> "${join(dir, "node.log")}"
for a in "$@"; do [ -f "$a" ] && cp "$a" "${sent}/$(basename "$a")"; done
cat "${join(dir, "dropbox.txt")}"
exit 0
`,
    "utf-8",
  );
  await writeFile(
    join(bin, "date"),
    `#!/bin/bash
case "$*" in
  "-u +%d") echo "${opts.day ?? "01"}" ;;
  "-u +%Y-%m") echo "${opts.month ?? "2026-11"}" ;;
  *) exec /bin/date "$@" ;;
esac
`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);
  await chmod(join(bin, "date"), 0o755);

  let code = 0;
  let out: string;
  try {
    const r = await execFileAsync("bash", ["-e", "-c", script], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
        GITHUB_OUTPUT: join(dir, "GITHUB_OUTPUT"),
        ...opts.env,
      },
    });
    out = r.stdout + r.stderr;
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    code = err.code ?? 1;
    out = (err.stdout ?? "") + (err.stderr ?? "");
  }
  const outputs = Object.fromEntries(
    (await readFile(join(dir, "GITHUB_OUTPUT"), "utf-8"))
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const log = await readFile(join(dir, "node.log"), "utf-8").catch(() => "");
  const nodeCalls = log
    .split("\x1e")
    .filter((r) => r !== "")
    .map((r) => r.split("\x1f").slice(0, -1));
  const uploaded: Record<string, string> = {};
  for (const f of await readdir(sent)) uploaded[f] = await readFile(join(sent, f), "utf-8");
  return { code, out, outputs, nodeCalls, uploaded };
}

describe("fleet-db-backup › Decide the monthly Dropbox copy", () => {
  // POSITIVE CONTROL first: the night the copy exists for.
  it("copies on the first of the UTC month, and names the month", async () => {
    const r = await runStep(decide, {
      day: "01",
      month: "2026-11",
      env: { ...SECRETS, FORCE: "false" },
    });
    expect(r.code).toBe(0);
    expect(r.outputs).toEqual({ due: "true", month: "2026-11" });
    expect(r.out).not.toContain("::warning::");
  });

  it("does not copy on any other night", async () => {
    for (const day of ["02", "15", "28", "31"]) {
      const r = await runStep(decide, { day, env: { ...SECRETS, FORCE: "false" } });
      expect(r.code, day).toBe(0);
      expect(r.outputs.due, day).toBe("false");
    }
  });

  it("copies on any night when the dispatch forces it (dropbox_copy: true)", async () => {
    const r = await runStep(decide, {
      day: "20",
      month: "2026-10",
      env: { ...SECRETS, FORCE: "true" },
    });
    expect(r.outputs).toEqual({ due: "true", month: "2026-10" });
  });

  it("an unset FORCE (a nightly dispatch carries no inputs) does not force", async () => {
    const r = await runStep(decide, { day: "20", env: { ...SECRETS } });
    expect(r.outputs.due).toBe("false");
  });

  it("with the secrets absent, skips with a warning naming all three, and never fails", async () => {
    const r = await runStep(decide, { day: "01", env: { ...NO_SECRETS, FORCE: "true" } });
    expect(r.code).toBe(0);
    expect(r.outputs.due).toBe("false");
    const warning = r.out.split("\n").find((l) => l.startsWith("::warning::"));
    expect(warning).toBeDefined();
    for (const name of Object.keys(SECRETS)) expect(warning).toContain(name);
  });

  it("names only the secret that is missing", async () => {
    const r = await runStep(decide, {
      day: "01",
      env: { ...SECRETS, DROPBOX_APP_SECRET: "", FORCE: "false" },
    });
    expect(r.outputs.due).toBe("false");
    expect(r.out).toContain("DROPBOX_APP_SECRET");
    expect(r.out).not.toContain("DROPBOX_APP_KEY");
  });

  it("is quiet on an ordinary night even with the secrets absent", async () => {
    const r = await runStep(decide, { day: "15", env: { ...NO_SECRETS, FORCE: "false" } });
    expect(r.outputs.due).toBe("false");
    expect(r.out).not.toContain("::warning::");
  });
});

describe("fleet-db-backup › Copy the encrypted dump to Dropbox", () => {
  const PATH_NOV = `${FOLDER}/turso-2026-11.sql.gpg`;
  const good = `${TEAM_ACCOUNT}\n${okLine(PATH_NOV, CIPHERTEXT)}\n`;

  it("uploads the ENCRYPTED dump as turso-YYYY-MM.sql.gpg to /Reddoor/Backups/turso, and passes on the hash match", async () => {
    const r = await runStep(copy, { env: { ...SECRETS, MONTH: "2026-11" }, dropboxOut: good });
    expect(r.code).toBe(0);
    expect(r.nodeCalls).toHaveLength(1);
    const [script, cmd, folder, ...files] = r.nodeCalls[0]!;
    expect([script, cmd, folder]).toEqual(["scripts/dropbox.mjs", "upload", FOLDER]);
    expect(files.map((f) => f.split("/").pop())).toEqual(["turso-2026-11.sql.gpg"]);
    expect(r.uploaded).toEqual({ "turso-2026-11.sql.gpg": CIPHERTEXT });
    expect(r.out).not.toContain("::warning::");
  });

  it("never prints the account's email address into the run log", async () => {
    const r = await runStep(copy, { env: { ...SECRETS, MONTH: "2026-11" }, dropboxOut: good });
    expect(r.out).toContain("(team space)");
    expect(r.out).not.toContain("ada@example.com");
  });

  it("FAILS with its own warning when dropbox.mjs reports a hash MISMATCH", async () => {
    const r = await runStep(copy, {
      env: { ...SECRETS, MONTH: "2026-11" },
      dropboxOut: `${TEAM_ACCOUNT}\nMISMATCH ${PATH_NOV}: local 35 bytes aa, Dropbox 34 bytes bb\n`,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/^::warning::monthly Dropbox copy/m);
  });

  it("FAILS when dropbox.mjs printed no ok line at all (absent line = never ran)", async () => {
    const r = await runStep(copy, { env: { ...SECRETS, MONTH: "2026-11" }, dropboxOut: "" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/^::warning::monthly Dropbox copy/m);
  });

  it("FAILS when the ok line names another month's file", async () => {
    const r = await runStep(copy, {
      env: { ...SECRETS, MONTH: "2026-11" },
      dropboxOut: `${TEAM_ACCOUNT}\n${okLine(`${FOLDER}/turso-2026-10.sql.gpg`, CIPHERTEXT)}\n`,
    });
    expect(r.code).not.toBe(0);
  });

  it("FAILS when the token resolves to a personal space, not the team space", async () => {
    const r = await runStep(copy, {
      env: { ...SECRETS, MONTH: "2026-11" },
      dropboxOut: `${PERSONAL_ACCOUNT}\n${okLine(PATH_NOV, CIPHERTEXT)}\n`,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("team space");
  });

  it("FAILS before uploading anything when MONTH is not YYYY-MM", async () => {
    for (const month of ["", "12345", "2026-11-01", "../x"]) {
      const r = await runStep(copy, { env: { ...SECRETS, MONTH: month }, dropboxOut: good });
      expect(r.code, month).not.toBe(0);
      expect(r.nodeCalls, month).toEqual([]);
    }
  });

  // Every case above hands the gate CANNED dropbox.mjs lines. This one feeds it
  // the lines the REAL `run()` prints for an upload, so a change to the
  // script's wording breaks this test rather than production.
  it("PASSES on the lines the real dropbox.mjs prints for a matching upload", async () => {
    const data = Buffer.from(CIPHERTEXT);
    const dir = await mkdtemp(join(tmpdir(), "db-backup-dropbox-real-"));
    const local = join(dir, "turso-2026-11.sql.gpg");
    await writeFile(local, data);
    const fetch = async (url: string) => {
      const endpoint = url.replace(/^https:\/\/[^/]+\/(2\/)?/, "");
      const body =
        endpoint === "oauth2/token"
          ? { access_token: "tok" }
          : endpoint === "users/get_current_account"
            ? {
                name: { display_name: "Ada Example" },
                email: "ada@example.com",
                team: { name: "Example Team" },
                root_info: { root_namespace_id: "1111111111", home_namespace_id: "2222222222" },
              }
            : { path_display: PATH_NOV, size: data.length, content_hash: contentHash(data) };
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(body),
      };
    };
    const real = await run(
      { cmd: "upload", folder: FOLDER, files: [local], overwrite: true },
      { fetch, env: SECRETS },
    );
    expect(real.code).toBe(0);
    const r = await runStep(copy, {
      env: { ...SECRETS, MONTH: "2026-11" },
      dropboxOut: real.lines.join("\n") + "\n",
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::warning::");
  });
});

describe("fleet-db-backup — where the Dropbox copy sits, and what it may break", () => {
  const labels = () =>
    workflowSteps(wf)
      .filter((s) => s.job === "backup")
      .map((s) => s.label);
  const step = (label: string) => workflowSteps(wf).find((s) => s.label === label);

  it("finds both steps (a missing step must not pass as a correct one)", () => {
    expect(step(DECIDE)).toBeDefined();
    expect(step(COPY)).toBeDefined();
  });

  it("runs after the encrypt step's re-verify AND after the artifact upload", () => {
    const l = labels();
    expect(l.indexOf("Encrypt")).toBeGreaterThan(-1);
    expect(l.indexOf("Upload encrypted dump")).toBeGreaterThan(l.indexOf("Encrypt"));
    expect(l.indexOf(DECIDE)).toBeGreaterThan(l.indexOf("Upload encrypted dump"));
    expect(l.indexOf(COPY)).toBe(l.indexOf(DECIDE) + 1);
  });

  it("a Dropbox failure can never turn the backup red: the copy is continue-on-error and bounded", () => {
    const s = step(COPY)!;
    expect(s.continueOnError).toBe("true");
    expect(s.timeoutMinutes).toBeGreaterThan(0);
    expect(s.if).toBe("steps.dropbox-due.outputs.due == 'true'");
  });

  it("the decide step cannot fail on the network: it calls nothing but date", () => {
    expect(decide).not.toMatch(/\bnode\b|\bcurl\b|dropbox\.mjs/);
  });

  it("dispatch takes dropbox_copy: a boolean, false unless asked", () => {
    const doc = yaml.load(wf) as {
      on: { workflow_dispatch: { inputs: Record<string, Record<string, unknown>> } };
    };
    expect(doc.on.workflow_dispatch.inputs["dropbox_copy"]).toMatchObject({
      type: "boolean",
      default: false,
    });
  });

  it("wires the secrets, the force input and the month exactly", () => {
    expect(stepEnv(wf, DECIDE)).toEqual({
      FORCE: "${{ inputs.dropbox_copy }}",
      DROPBOX_APP_KEY: "${{ secrets.DROPBOX_APP_KEY }}",
      DROPBOX_APP_SECRET: "${{ secrets.DROPBOX_APP_SECRET }}",
      DROPBOX_REFRESH_TOKEN: "${{ secrets.DROPBOX_REFRESH_TOKEN }}",
    });
    expect(stepEnv(wf, COPY)).toEqual({
      MONTH: "${{ steps.dropbox-due.outputs.month }}",
      DROPBOX_APP_KEY: "${{ secrets.DROPBOX_APP_KEY }}",
      DROPBOX_APP_SECRET: "${{ secrets.DROPBOX_APP_SECRET }}",
      DROPBOX_REFRESH_TOKEN: "${{ secrets.DROPBOX_REFRESH_TOKEN }}",
    });
  });

  it("the copy never sees the passphrase", () => {
    expect(Object.keys(stepEnv(wf, COPY))).not.toContain("BACKUP_PASSPHRASE");
    expect(copy).not.toContain("BACKUP_PASSPHRASE");
  });
});
