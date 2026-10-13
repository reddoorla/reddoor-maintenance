import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The PM loop moved to `reddoorla/reddoor-workspace` at the 2026-10-23 cutover (P1-33, the
 * two-touch review's amendment 3). These files stay here, frozen as they stood that day:
 * `docs/pm-pass.md` and `docs/worker-brief.md` as stubs naming the new home, and the backlog,
 * the morning reports, the briefs and the operating-model documents whole, because runbooks,
 * `src/reports/types.ts` and tests cite their item numbers. A session that still writes here,
 * from habit or a brief written before the cutover, would put the day's state where no PM pass
 * reads it, and nobody would notice. So this test fails on any change, and on any file added
 * to or removed from the two frozen folders.
 *
 * The one edit a frozen file may take is a forward pointer, a line starting `> Superseded`
 * (CLAUDE.md, "The work journal"); the digest drops those lines, as `journal-frozen.test.ts`
 * does. To re-freeze on purpose (the cutover PR re-runs this the day it lands), recompute
 * `FROZEN` with `frozenDigest` over the same set and paste it in.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const FROZEN_FILES = [
  "docs/BACKLOG.md",
  "docs/pm-pass.md",
  "docs/worker-brief.md",
  "docs/operating-model-review-2026-09-29.md",
  "docs/operating-model-rollout.md",
  "docs/autonomy-journal.md",
];
const FROZEN_DIRS = ["docs/morning-reports", "docs/briefs"];

const FROZEN: Record<string, string> = {
  "docs/BACKLOG.md": "a9cb253bd31f1c651b4ad6e67abb97c854561327abfa987c507e58da448bf883",
  "docs/autonomy-journal.md": "959cd16a47ac499ae8cc780ecd576cc6416b47bf62216daf507e3bb413e00c5c",
  "docs/briefs/2026-10-01-williamson-video-hd.md":
    "bd7e99126afeab505d268066a5daa074e4bf724f03a074d52ddb67a293bcdd1f",
  "docs/briefs/2026-10-04-fleet-video-rollout.md":
    "eee84a9d99b4b2f0c043b323347e2c0feb404eeca9ad890903be62bdcdf84ca6",
  "docs/morning-reports/MORNING_REPORT_2026-05-22.md":
    "f0ad25bec8a068da51a0cbc76b3a64e4228f5f8ab1d659bcbf03f04cecd35456",
  "docs/morning-reports/MORNING_REPORT_2026-05-27-bug-hunt.md":
    "0dec4a854e4b1e4a6ab419bf3abcdb64268faa08885d3be5fb827ce985d9b7a3",
  "docs/morning-reports/MORNING_REPORT_2026-05-27.md":
    "3f397ec1cea66c465fd928b4b01a7b4bb1ab8861d284b273bd1504d74d1fbd56",
  "docs/morning-reports/MORNING_REPORT_2026-05-28.md":
    "3518d66a952bf4c208a8b4c1b1734335918532641a8cab0bfbd96e05cf925817",
  "docs/morning-reports/MORNING_REPORT_2026-05-29.md":
    "1cabfad40d8767c4aa4e05bf5e6b06debac7e616300c8737406b7e5f94ad860a",
  "docs/morning-reports/MORNING_REPORT_2026-06-02.md":
    "52755d791467e2bcb79a9ce84bf1dff30225900e96a8dc33d47dfdc705232e2d",
  "docs/morning-reports/MORNING_REPORT_2026-06-05-recipe-deprecation.md":
    "516e3ca89103a700f8301729884513dd028c9d0e8eb391d6cfc70a570f493ac1",
  "docs/morning-reports/MORNING_REPORT_2026-06-05.md":
    "9dd9a207435010ac418993b9c89054b018195da880e5d05640cf6564d57f88aa",
  "docs/morning-reports/MORNING_REPORT_2026-06-09.md":
    "cde980e467b0f688f376f89f09af2089acc5eeb3d6e8b76b22676e9e3fd2885b",
  "docs/morning-reports/MORNING_REPORT_2026-06-10.md":
    "f14b9415026fad3be1dc4f744d1e2c9add9f64f76d2ee222af3f31291d1f6605",
  "docs/morning-reports/MORNING_REPORT_2026-06-23.md":
    "4b7c213d63873eba170c7fce0aedc1170be939542ce8142a37dff20a8cdbc9f3",
  "docs/morning-reports/MORNING_REPORT_2026-06-30.md":
    "e39d686c9c54e85a6f7a47056b916e122d3eecfd9f65e592b9872d452bbfdf74",
  "docs/morning-reports/MORNING_REPORT_2026-07-01.md":
    "69582e749bcb982e96fd01ab728526d5ab924581f24245354de76e9e3ff40a39",
  "docs/morning-reports/MORNING_REPORT_2026-07-06.md":
    "3f4c0303c4cdcf52c502da2427b7f44588ddc2c3650d5c2d249b72e9e8c23524",
  "docs/morning-reports/MORNING_REPORT_2026-08-26.md":
    "5b05bb9d41fb6138cd070a803599788cb44285a0b6078c84b3b3258b592f4271",
  "docs/morning-reports/MORNING_REPORT_2026-09-02.md":
    "75b568a3aa6aec0a4ee0a8a91fc8d236365dc90cc19fe20d415d6129f35e21be",
  "docs/morning-reports/MORNING_REPORT_2026-09-29.md":
    "968ebe9e2252430dcc7d7db78e18d43fccabe7cb132a03c6c634c8ea981abbea",
  "docs/morning-reports/MORNING_REPORT_2026-09-30.md":
    "ae4f068fc30b68dba78f7df343a231bf99af26d2054db92028b25440330fc759",
  "docs/morning-reports/MORNING_REPORT_2026-10-01.md":
    "259b49fdf7acae4475d008d3d8c6f57298899ffec9abcab77d915914ad4dee9e",
  "docs/morning-reports/MORNING_REPORT_2026-10-04.md":
    "46f9981405e05ef5456108e2b953251170d7c232963b1e2bd32559211429c8c2",
  "docs/morning-reports/MORNING_REPORT_2026-10-05.md":
    "9629e833bb0edcffdab35dba52394935347d35d80fe5a09c2dcea833abe5fb44",
  "docs/morning-reports/MORNING_REPORT_2026-10-06.md":
    "ba68be263f77baae0ff3fd08e4389a80eebaa4e45fab0048909ecdb062e5025d",
  "docs/morning-reports/MORNING_REPORT_2026-10-07.md":
    "32dcf2e230aeff73686d0d682751cc30ebeea03c71362e8c5189ab1bc0d40bed",
  "docs/morning-reports/MORNING_REPORT_2026-10-08.md":
    "b34165839e3b2f5d4699ba75d092ee90c44220d23410375d7680fa12d73b9f57",
  "docs/morning-reports/MORNING_REPORT_2026-10-11.md":
    "0a99897068d48376e75d909064245d38443542200a59f3c40e96b79edefb937a",
  "docs/morning-reports/MORNING_REPORT_2026-10-12.md":
    "35e64637d52259298ac380f9231c87e920c2930a75650903569bda118e5a6750",
  "docs/morning-reports/MORNING_REPORT_2026-10-13.md":
    "00d63186473e3eb3658eeafacaaac3e5d64310e9537a869247020e509e73721b",
  "docs/operating-model-review-2026-09-29.md":
    "d76720875a0ccdd83bc3829d5269e723cf103a2cf2888d8c663c919775ba7761",
  "docs/operating-model-rollout.md":
    "a830f70ab6eef35d37f19813278413369acf0b43c6f4f2e7c7db7f6a8667e955",
  "docs/pm-pass.md": "33b210e185e395c97ca5fc03c0d0a056ae2db34f532801b8f4163fa032f44d0b",
  "docs/worker-brief.md": "2537a0e5c4463e957e9f3037bd8cd15cc4e062f47d6075831ea56931299a6f6c",
};

function frozenDigest(text: string): string {
  const kept = text
    .split("\n")
    .filter((line) => !line.startsWith("> Superseded"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return createHash("sha256").update(kept).digest("hex");
}

function changedFiles(root: string, table: Record<string, string>): string[] {
  return frozenSet(root).filter(
    (f) => frozenDigest(readFileSync(join(root, f), "utf8")) !== table[f],
  );
}

function frozenSet(root: string): string[] {
  return [
    ...FROZEN_FILES,
    ...FROZEN_DIRS.flatMap((dir) => readdirSync(join(root, dir)).map((f) => `${dir}/${f}`)),
  ].sort();
}

describe("frozenDigest", () => {
  const base = "# Report\n\n## One-line verdict\n\nAll green.\n";

  it("is unchanged by a forward pointer", () => {
    const pointed = base.replace(
      "## One-line verdict\n",
      "## One-line verdict\n\n> Superseded in part by 2026-10-26 — A later report.\n",
    );
    expect(pointed).not.toBe(base);
    expect(frozenDigest(pointed)).toBe(frozenDigest(base));
  });

  it("changes when a line is appended", () => {
    expect(frozenDigest(`${base}\nA new line.\n`)).not.toBe(frozenDigest(base));
  });

  it("changes when a line is edited in place", () => {
    expect(frozenDigest(base.replace("All green", "All red"))).not.toBe(frozenDigest(base));
  });
});

describe("changedFiles, on a scratch copy of the frozen set", () => {
  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), "moved-files-"));
    for (const f of frozenSet(ROOT)) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      writeFileSync(join(root, f), readFileSync(join(ROOT, f)));
    }
    return root;
  }

  it("lists nothing for an unchanged copy, and the file a scratch append touched", () => {
    const root = scratch();
    expect(changedFiles(root, FROZEN)).toEqual([]);
    appendFileSync(join(root, "docs/pm-pass.md"), "A line a stale session appended.\n");
    expect(changedFiles(root, FROZEN)).toEqual(["docs/pm-pass.md"]);
  });
});

describe("files moved to reddoorla/reddoor-workspace", () => {
  it("the frozen set is exactly the files the digest table names, and is not empty", () => {
    const set = frozenSet(ROOT);
    expect(set.length).toBeGreaterThan(FROZEN_FILES.length);
    for (const f of ["docs/BACKLOG.md", "docs/pm-pass.md", "docs/worker-brief.md"])
      expect(Object.keys(FROZEN)).toContain(f);
    expect(
      set,
      "A file was added to or removed from a frozen folder. New PM-loop files go to reddoorla/reddoor-workspace.",
    ).toEqual(Object.keys(FROZEN).sort());
  });

  it("no frozen file has changed", () => {
    const changed = changedFiles(ROOT, FROZEN);
    expect(
      changed,
      "These files moved to reddoorla/reddoor-workspace on 2026-10-23 and are frozen here. Change the home-base copy instead; the only edit allowed here is a '> Superseded' pointer.",
    ).toEqual([]);
  });
});
