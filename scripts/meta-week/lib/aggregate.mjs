// Pure aggregation over usage events. No I/O.
export const COUNTERS = ["in", "out", "cacheCreate", "cacheRead"];

export function emptySum() {
  return { requests: 0, in: 0, out: 0, cacheCreate: 0, cacheRead: 0 };
}

export function add(sum, ev) {
  sum.requests += 1;
  for (const c of COUNTERS) sum[c] += ev[c];
  return sum;
}

/** YYYY-MM-DD of an ISO timestamp in an IANA timezone. */
export function localDate(ts, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** ISO-8601 week label (YYYY-Www) for a YYYY-MM-DD string. */
export function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function dimKey(ev, dims, tz) {
  return dims
    .map((d) => {
      if (d === "day") return localDate(ev.ts, tz);
      if (d === "week") return isoWeek(localDate(ev.ts, tz));
      if (d === "session") return ev.sessionId;
      return String(ev[d] ?? "");
    })
    .join(" | ");
}

export function groupBy(events, keyFn) {
  const m = new Map();
  for (const ev of events) {
    const k = keyFn(ev);
    if (!m.has(k)) m.set(k, emptySum());
    add(m.get(k), ev);
  }
  return [...m.entries()]
    .map(([key, sum]) => ({ key, ...sum }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function filterDates(events, tz, from, to) {
  if (!from && !to) return events;
  return events.filter((ev) => {
    const d = localDate(ev.ts, tz);
    return (!from || d >= from) && (!to || d <= to);
  });
}

export function inWindow(ev, startMs, endMs) {
  const t = Date.parse(ev.ts);
  return t >= startMs && t < endMs;
}
