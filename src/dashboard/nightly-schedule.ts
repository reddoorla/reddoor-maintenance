/**
 * P1-78g: the two clocks' schedules, for the overview's timeline. The Netlify
 * functions keep their own literal (`netlify/functions/nightly-clock.mts:5`,
 * `nightly-send-clock.mts:5`), because Netlify reads `config.schedule` statically;
 * tests/dashboard/nightly-schedule.test.ts fails if either drifts from these.
 */
export const NIGHTLY_CRON = "7 6 * * *";
export const SEND_CRON = "7 16 * * *";

const PACIFIC_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** The next firing of a daily UTC cron (`M H * * *`) at or after `now`. */
export function nextDailyFiring(cron: string, now: Date): Date {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron);
  if (!m) throw new Error(`nextDailyFiring: not a daily cron: ${cron}`);
  const at = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(m[2]), Number(m[1])),
  );
  if (at.getTime() < now.getTime()) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

/** A daily UTC cron's next firing as Pacific clock time, "11:07pm PT", so the shown
 *  time follows daylight saving instead of being typed for one half of the year. */
export function pacificTimeOfCron(cron: string, now: Date): string {
  const parts = PACIFIC_TIME.formatToParts(nextDailyFiring(cron, now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase()} PT`;
}
