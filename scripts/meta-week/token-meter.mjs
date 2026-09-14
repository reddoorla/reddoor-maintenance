#!/usr/bin/env node
// Token meter over Claude Code transcripts. Method, calibration and caveats are in
// docs/meta-week/10-token-meter.md. No dependencies: runs from any checkout.
//
//   node scripts/meta-week/token-meter.mjs [--root DIR] [--stats FILE] [--tz IANA]
//     [--lane main|subagent|all] [--by day,week,repo,session,lane,model,effort,agent,skill]
//     [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--window ISO ISO]
//     [--calibrate] [--blocks] [--compactions] [--json FILE]
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  COUNTERS,
  add,
  dimKey,
  emptySum,
  filterDates,
  groupBy,
  inWindow,
  reconcile,
} from "./lib/aggregate.mjs";
import { collectEvents } from "./lib/walk.mjs";

function parseArgs(argv) {
  const o = {
    root: join(homedir(), ".claude", "projects"),
    stats: join(homedir(), ".claude", "stats-cache.json"),
    tz: "America/Los_Angeles",
    lane: "all",
    by: null,
    from: null,
    to: null,
    window: null,
    calibrate: false,
    blocks: false,
    compactions: false,
    json: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--root":
        o.root = next();
        break;
      case "--stats":
        o.stats = next();
        break;
      case "--tz":
        o.tz = next();
        break;
      case "--lane":
        o.lane = next();
        break;
      case "--by":
        o.by = next().split(",");
        break;
      case "--from":
        o.from = next();
        break;
      case "--to":
        o.to = next();
        break;
      case "--window":
        o.window = [next(), next()];
        break;
      case "--calibrate":
        o.calibrate = true;
        break;
      case "--blocks":
        o.blocks = true;
        break;
      case "--compactions":
        o.compactions = true;
        break;
      case "--json":
        o.json = next();
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!["main", "subagent", "all"].includes(o.lane))
    throw new Error(`--lane must be main|subagent|all`);
  const DIMS = ["day", "week", "repo", "session", "lane", "model", "effort", "agent", "skill"];
  for (const d of o.by || [])
    if (!DIMS.includes(d)) throw new Error(`--by: unknown dimension ${d}`);
  return o;
}

const fmt = (n) => Number(n).toLocaleString("en-US");

function printTotal(label, s) {
  process.stdout.write(
    `${label}\t${fmt(s.requests)}\t${COUNTERS.map((c) => fmt(s[c])).join("\t")}\n`,
  );
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = await collectEvents(o.root);
  const laneEvents = o.lane === "all" ? all.usage : all.usage.filter((e) => e.lane === o.lane);
  const events = filterDates(laneEvents, o.tz, o.from, o.to);
  const dims = o.by || ["day"];
  const result = {
    root: o.root,
    tz: o.tz,
    lane: o.lane,
    from: o.from,
    to: o.to,
    files: all.files,
    lines: all.lines,
    by: dims,
    total: events.reduce(add, emptySum()),
    groups: groupBy(events, (ev) => dimKey(ev, dims, o.tz)),
  };
  if (o.window) {
    const [s, e] = o.window.map((x) => Date.parse(x));
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) {
      throw new Error("--window needs two ISO timestamps, start before end");
    }
    const inW = events.filter((ev) => inWindow(ev, s, e));
    result.window = {
      start: o.window[0],
      end: o.window[1],
      total: inW.reduce(add, emptySum()),
      byModel: groupBy(inW, (ev) => ev.model),
    };
  }
  if (o.calibrate) {
    const stats = JSON.parse(await readFile(o.stats, "utf-8"));
    result.calibration = reconcile(events, stats, o.tz);
  }
  process.stdout.write(
    `files=${all.files} lines=${fmt(all.lines)} requests=${fmt(events.length)} lane=${o.lane} tz=${o.tz} by=${dims.join(",")}\n`,
  );
  process.stdout.write(["key", "requests", ...COUNTERS].join("\t") + "\n");
  for (const g of result.groups) printTotal(g.key, g);
  printTotal("TOTAL", result.total);
  if (result.window) {
    process.stdout.write(`\nWINDOW\t${result.window.start} → ${result.window.end}\n`);
    for (const g of result.window.byModel) printTotal(g.key, g);
    printTotal("WINDOW TOTAL", result.window.total);
  }
  if (result.calibration) {
    const c = result.calibration;
    process.stdout.write(
      `\nCALIBRATION coverage=${c.coverage.oldest}..${c.coverage.newest} rows=${c.rows.length} tz=${o.tz} lane=${o.lane}\n`,
    );
    for (const v of c.verdicts) {
      process.stdout.write(
        `  unit=${v.unit}\tmedianRelErr=${v.medianRelErr.toFixed(3)}\tp90RelErr=${v.p90RelErr.toFixed(3)}\n`,
      );
    }
    process.stdout.write(
      `VERDICT ${c.reconciled ? "RECONCILED" : "NOT RECONCILED"} best=${c.best ? c.best.unit : "none"} missingFromStats=${c.missingFromStats.join(",") || "none"}\n`,
    );
  }
  if (o.json) await writeFile(o.json, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  process.stderr.write(`token-meter: ${e.message}\n`);
  process.exit(1);
});
