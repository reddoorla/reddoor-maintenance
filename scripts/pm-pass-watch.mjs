#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export const LA = "America/Los_Angeles";
export const PM_PASS = "docs/pm-pass.md";
export const SCHEDULE_HEADING = "### The Routine's stored prompt (both passes)";
export const FIRST_COVERED = "2026-10-06";
export const KNOWN_GOOD = { at: "2026-10-06T07:00:00Z", minute: 48, hours: [4, 17] };
export const WINDOW_HOURS = 20;
export const PASSES = ["morning", "second"];
export const MARKERS = {
  morning: /^## One-line verdict\b/m,
  second: /^## Evening\b/m,
};
export const FROM = "Reddoor Reports <reports@reddoorla.com>";
export const RESEND_URL = "https://api.resend.com/emails";

const USAGE =
  "usage: node scripts/pm-pass-watch.mjs [--ref origin/main] [--date YYYY-MM-DD] [--pass morning|second|both] [--now <iso Z>] [--dry-run] [--test-send]";

const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(argv) {
  const o = {
    ref: "origin/main",
    date: undefined,
    pass: "both",
    now: undefined,
    dryRun: false,
    testSend: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--ref") o.ref = next();
    else if (a === "--date") {
      const v = next();
      if (!DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
        throw new Error(`--date needs YYYY-MM-DD, got ${v}`);
      o.date = v;
    } else if (a === "--pass") {
      const v = next();
      if (!["morning", "second", "both"].includes(v))
        throw new Error(`--pass needs morning, second or both, got ${v}`);
      o.pass = v;
    } else if (a === "--now") {
      const v = next();
      if (Number.isNaN(Date.parse(v)) || !/Z$/.test(v))
        throw new Error(`--now needs an ISO time ending in Z`);
      o.now = v;
    } else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--test-send") o.testSend = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export function scheduleLine(text) {
  if (typeof text !== "string") return null;
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === SCHEDULE_HEADING);
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#/.test(lines[i])) return null;
    if (lines[i].startsWith("- **Schedule:**")) return lines[i];
  }
  return null;
}

function validZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function parseDays(field) {
  if (field === "*") return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = new Set();
  for (const part of field.split(",")) {
    const m = /^(\d)(?:-(\d))?$/.exec(part);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (lo > 7 || hi > 7 || hi < lo) return null;
    for (let d = lo; d <= hi; d++) days.add(d % 7);
  }
  return days;
}

export function parseSchedule(line) {
  if (typeof line !== "string") return null;
  const m =
    /`CRON_TZ=([A-Za-z_]+(?:\/[A-Za-z_+-]+)*) (\d{1,2}) (\d{1,2}),(\d{1,2}) \* \* ([0-9*,-]+)`/.exec(
      line,
    );
  if (!m) return null;
  const [, zone, min, h1, h2, dayField] = m;
  const minute = Number(min);
  const hours = [Number(h1), Number(h2)];
  if (minute > 59 || hours[0] > 23 || hours[1] > 23 || hours[0] >= hours[1]) return null;
  if (!validZone(zone)) return null;
  const days = parseDays(dayField);
  if (!days || days.size === 0) return null;
  return { zone, minute, hours, days, cron: `${minute} ${hours[0]},${hours[1]} * * ${dayField}` };
}

function offsetMs(zone, ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export function zonedToUtc(date, hour, minute, zone) {
  const [y, mo, d] = date.split("-").map(Number);
  const local = Date.UTC(y, mo - 1, d, hour, minute);
  const first = local - offsetMs(zone, local);
  return local - offsetMs(zone, first);
}

export function localDate(ms, zone = LA) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function weekday(date) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function dueAt(date, pass, sched) {
  const hour = pass === "morning" ? sched.hours[0] : sched.hours[1];
  const fire = zonedToUtc(date, hour, sched.minute, sched.zone);
  const grace = pass === "morning" ? (weekday(date) === 1 ? 120 : 90) : 60;
  return fire + grace * 60_000;
}

export function realGit(cwd) {
  return (args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

function revBefore(git, ref, iso) {
  const r = git(["rev-list", "-1", "--first-parent", `--before=${iso}`, ref]);
  if (r.code !== 0) return "";
  return r.stdout.trim();
}

function showFile(git, sha, path) {
  const r = git(["show", `${sha}:${path}`]);
  return r.code === 0 ? r.stdout : null;
}

export function blindCheck(git, ref) {
  const sha = revBefore(git, ref, KNOWN_GOOD.at);
  if (!sha)
    return `no commit on ${ref} before ${KNOWN_GOOD.at}, so history is missing (a shallow clone?)`;
  const sched = parseSchedule(scheduleLine(showFile(git, sha, PM_PASS)));
  if (
    !sched ||
    sched.minute !== KNOWN_GOOD.minute ||
    sched.hours.join(",") !== KNOWN_GOOD.hours.join(",")
  )
    return `the known-good Schedule line at ${sha.slice(0, 8)} does not read ${KNOWN_GOOD.minute} ${KNOWN_GOOD.hours.join(",")}`;
  return null;
}

export function evaluateSlot(git, ref, date, pass, now) {
  const slot = {
    date,
    pass,
    schedule: "none",
    read: "none",
    due: "none",
    verdict: "",
    reason: "",
    dueSha: "",
  };
  const covered = date >= FIRST_COVERED;
  const midnight = isoZ(zonedToUtc(date, 0, 0, LA));
  const readSha = revBefore(git, ref, midnight);
  if (readSha) slot.read = readSha.slice(0, 8);
  const sched = readSha ? parseSchedule(scheduleLine(showFile(git, readSha, PM_PASS))) : null;
  if (!sched) {
    if (!covered) return { ...slot, verdict: "not-covered" };
    slot.reason = readSha
      ? `the Schedule line at ${slot.read} (as of ${midnight}) does not parse as a two-pass cron`
      : `no commit on ${ref} before ${midnight}`;
    return { ...slot, verdict: "blind" };
  }
  slot.schedule = sched.cron;
  if (!sched.days.has(weekday(date))) return { ...slot, verdict: "no-pass" };
  const due = dueAt(date, pass, sched);
  slot.due = isoZ(due);
  slot.dueMs = due;
  if (now < due) return { ...slot, verdict: "not-due" };
  const dueSha = revBefore(git, ref, slot.due);
  if (!dueSha)
    return { ...slot, verdict: "blind", reason: `no commit on ${ref} before ${slot.due}` };
  slot.dueSha = dueSha.slice(0, 8);
  const report = showFile(git, dueSha, `docs/morning-reports/MORNING_REPORT_${date}.md`);
  const ran = report !== null && MARKERS[pass].test(report);
  return { ...slot, verdict: ran ? "ran" : "missed" };
}

export function formatSlot(s) {
  const schedule = s.schedule === "none" ? "none" : `"${s.schedule}"`;
  return `PM_WATCH date=${s.date} pass=${s.pass} schedule=${schedule} read=${s.read} due=${s.due} verdict=${s.verdict}`;
}

function addDays(date, n) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

export function planSlots(o, now) {
  const passes = o.pass === "both" ? PASSES : [o.pass];
  if (o.date) return { dates: [o.date], passes, windowed: false };
  if (o.pass !== "both") return { dates: [localDate(now)], passes, windowed: false };
  const today = localDate(now);
  const earliest = localDate(now - WINDOW_HOURS * 3_600_000);
  const dates =
    earliest === today ? [today] : [addDays(today, -1), today].filter((d) => d >= earliest);
  return { dates, passes, windowed: true };
}

export function missedEmail(s) {
  const file = `docs/morning-reports/MORNING_REPORT_${s.date}.md`;
  const marker = s.pass === "morning" ? "## One-line verdict" : "## Evening";
  return {
    key: `pm-pass-missed-${s.date}-${s.pass}`,
    subject: `PM pass missed: ${s.date} ${s.pass}`,
    text: [
      `The ${s.pass} PM pass for ${s.date} (America/Los_Angeles) had not landed on main by its due time.`,
      "",
      `Schedule: ${s.schedule} (read from ${PM_PASS} at ${s.read}, as of 00:00 PT on ${s.date})`,
      `Due: ${s.due}`,
      `main as of the due time: ${s.dueSha}`,
      `Looked for: ${marker} in ${file}`,
      "",
      "Check the Reddoor Project Manager Routine's last run, then run the pass by hand if it did not fire.",
      "This is sent once per slot. Set the repo variable PM_WATCH=off to silence the watcher.",
    ].join("\n"),
  };
}

export function blindEmail(today, reasons) {
  return {
    key: `pm-pass-watch-blind-${today}`,
    subject: `PM pass watch is blind: ${reasons[0]}`,
    text: [
      `The PM pass watcher could not look on ${today}, so it cannot say whether a pass was missed.`,
      "",
      ...reasons.map((r) => `- ${r}`),
      "",
      "Fix the watcher (scripts/pm-pass-watch.mjs, .github/workflows/pm-pass-watch.yml) before trusting its silence.",
    ].join("\n"),
  };
}

export function testEmail(today) {
  return {
    key: `pm-pass-watch-test-${today}`,
    subject: "[TEST] PM pass watch: the send path works",
    text: "A hand-dispatched test of the PM pass watcher's send path. Nothing was missed; no action needed.",
  };
}

export async function sendEmail(email, { apiKey, to, fetchImpl = fetch }) {
  const res = await fetchImpl(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": email.key,
    },
    body: JSON.stringify({ from: FROM, to: [to], subject: email.subject, text: email.text }),
  });
  const body = await res.text();
  if (res.ok) return "sent";
  if (res.status === 409 && /invalid_idempotent_request/.test(body)) return "already-sent";
  throw new Error(`Resend answered ${res.status} for ${email.key}: ${body}`);
}

export async function watch(o, deps = {}) {
  const env = deps.env ?? process.env;
  const git = deps.git ?? realGit(deps.cwd ?? process.cwd());
  const now = deps.now ?? (o.now ? Date.parse(o.now) : Date.now());
  const lines = [];
  const sent = [];
  const log = (l) => lines.push(l);

  if ((env.PM_WATCH ?? "").trim().toLowerCase() === "off") {
    log("PM_WATCH=off: skipped");
    return { code: 0, lines, sent, slots: [] };
  }
  const dry = o.dryRun || o.testSend;
  const to = (env.OPERATOR_EMAIL ?? "").trim();
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!o.dryRun || o.testSend) {
    if (!to) {
      log("PM_WATCH error: OPERATOR_EMAIL is empty, refusing to guess a recipient");
      return { code: 1, lines, sent, slots: [] };
    }
    if (!apiKey) {
      log("PM_WATCH error: RESEND_API_KEY is empty");
      return { code: 1, lines, sent, slots: [] };
    }
  }
  const send = async (email) => {
    const status = await sendEmail(email, { apiKey, to, fetchImpl: deps.fetch });
    sent.push({ ...email, status });
    log(`PM_WATCH_SENT key=${email.key} status=${status}`);
  };

  const today = localDate(now);
  const plan = planSlots(o, now);
  const blindReasons = [];
  const known = blindCheck(git, o.ref);
  const slots = [];
  for (const date of plan.dates) {
    for (const pass of plan.passes) {
      const s = known
        ? {
            date,
            pass,
            schedule: "none",
            read: "none",
            due: "none",
            verdict: "blind",
            reason: known,
          }
        : evaluateSlot(git, o.ref, date, pass, now);
      if (s.verdict === "no-pass") continue;
      if (plan.windowed && s.dueMs !== undefined && s.dueMs <= now - WINDOW_HOURS * 3_600_000)
        continue;
      slots.push(s);
      log(formatSlot(s));
    }
  }
  if (known) blindReasons.push(known);
  for (const s of slots)
    if (s.verdict === "blind" && s.reason && !blindReasons.includes(s.reason))
      blindReasons.push(s.reason);

  const count = (v) => slots.filter((s) => s.verdict === v).length;
  log(
    `PM_WATCH_SUMMARY slots=${slots.length} ran=${count("ran")} missed=${count("missed")} not-covered=${count("not-covered")} not-due=${count("not-due")} blind=${count("blind")} dry=${dry}`,
  );

  try {
    if (o.testSend) await send(testEmail(today));
    if (!dry) {
      if (blindReasons.length) await send(blindEmail(today, blindReasons));
      for (const s of slots.filter((x) => x.verdict === "missed")) await send(missedEmail(s));
    }
  } catch (e) {
    log(`PM_WATCH error: ${e.message}`);
    return { code: 1, lines, sent, slots };
  }
  if (blindReasons.length) {
    for (const r of blindReasons) log(`PM_WATCH blind: ${r}`);
    return { code: 1, lines, sent, slots };
  }
  return { code: 0, lines, sent, slots };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`pm-pass-watch: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const r = await watch(o);
  process.stdout.write(r.lines.join("\n") + "\n");
  process.exitCode = r.code;
}

const self = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
if (process.argv[1] && self(process.argv[1]) === self(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    process.stderr.write(`pm-pass-watch: ${e?.stack ?? e}\n`);
    process.exitCode = 1;
  });
}
