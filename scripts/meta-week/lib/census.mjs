// Pure candidate finders over the walker's full collection. Every finder nominates;
// none confirms. Costs are the meter's counters summed over a stated window.
import { COUNTERS, add, emptySum } from "./aggregate.mjs";

export const MIN = 60000;
export const STOP_RE = /\b(stop|kill (them|it|the agents|all)|halt|no more|hold on|wait,)\b/i;
export const CONTINUE_RE = /\bcontin/i;
export const CORRECTION_RE =
  /\b(that'?s wrong|you didn'?t|you missed|not what i|are you sure|did you actually|prove|show me|verify|check that|doesn'?t scan|is wrong)\b/i;

export function addSum(a, b) {
  a.requests += b.requests;
  for (const c of COUNTERS) a[c] += b[c];
  if (b.agentTotal) a.agentTotal = (a.agentTotal || 0) + b.agentTotal;
  return a;
}

/** Sum usage events with startMs < ts <= endMs that satisfy pred. */
export function sumBetween(events, pred, startMs, endMs) {
  const s = emptySum();
  for (const ev of events) {
    const t = Date.parse(ev.ts);
    if (t > startMs && t <= endMs && pred(ev)) add(s, ev);
  }
  return s;
}

export function bySession(items) {
  const m = new Map();
  for (const it of items) {
    if (!m.has(it.sessionId)) m.set(it.sessionId, []);
    m.get(it.sessionId).push(it);
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return m;
}

const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function fanoutCandidates(all) {
  const out = [];
  const mainPrompts = all.prompts.filter((p) => p.lane === "main");
  const promptsBy = bySession(mainPrompts);

  // 1. A stop request, then this session's subagents kept spending.
  for (const [sessionId, prompts] of promptsBy) {
    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      if (!STOP_RE.test(p.text)) continue;
      const start = Date.parse(p.ts);
      const end = prompts[i + 1] ? Date.parse(prompts[i + 1].ts) : start + 60 * MIN;
      const cost = sumBetween(
        all.usage,
        (ev) => ev.sessionId === sessionId && ev.lane === "subagent",
        start,
        end,
      );
      if (cost.requests === 0) continue;
      out.push({
        class: "fanout",
        kind: "spend-after-stop",
        sessionId,
        repo: p.repo,
        ts: p.ts,
        window: { from: p.ts, to: new Date(end).toISOString() },
        cost,
        evidence: { prompt: p.text.slice(0, 200), subagentRequestsAfter: cost.requests },
      });
    }
  }

  // 2. A limit block, then a "continue" within ten minutes: the re-orientation cost is the
  //    session's spend in the thirty minutes after the continue.
  for (const b of all.blocks) {
    const prompts = promptsBy.get(b.sessionId) || [];
    const t = Date.parse(b.ts);
    const c = prompts.find((p) => {
      const pt = Date.parse(p.ts);
      return pt > t && pt - t <= 10 * MIN && CONTINUE_RE.test(p.text);
    });
    if (!c) continue;
    const ct = Date.parse(c.ts);
    const cost = sumBetween(all.usage, (ev) => ev.sessionId === b.sessionId, ct, ct + 30 * MIN);
    out.push({
      class: "fanout",
      kind: "continue-after-block",
      sessionId: b.sessionId,
      repo: b.repo,
      ts: b.ts,
      window: { from: b.ts, to: new Date(ct + 30 * MIN).toISOString() },
      cost,
      evidence: { block: b.kind, prompt: c.text.slice(0, 120), lagMin: Math.round((ct - t) / MIN) },
    });
  }

  // 3. The same operator turn typed into three or more sessions inside two minutes.
  //    No token cost; the cost is operator attention, reported as a count.
  const sorted = mainPrompts
    .filter((p) => p.text.length >= 8)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (used.has(p.uuid)) continue;
    const key = normalize(p.text);
    const group = [p];
    const sessions = new Set([p.sessionId]);
    for (let j = i + 1; j < sorted.length; j++) {
      const q = sorted[j];
      if (Date.parse(q.ts) - Date.parse(p.ts) > 2 * MIN) break;
      if (used.has(q.uuid) || sessions.has(q.sessionId) || normalize(q.text) !== key) continue;
      group.push(q);
      sessions.add(q.sessionId);
    }
    if (group.length < 3) continue;
    for (const g of group) used.add(g.uuid);
    out.push({
      class: "fanout",
      kind: "same-turn-many-sessions",
      sessionId: p.sessionId,
      repo: p.repo,
      ts: p.ts,
      window: { from: p.ts, to: group[group.length - 1].ts },
      cost: emptySum(),
      evidence: {
        sessions: group.length,
        prompt: p.text.slice(0, 120),
        repos: [...new Set(group.map((g) => g.repo))].sort(),
      },
    });
  }
  return out;
}
