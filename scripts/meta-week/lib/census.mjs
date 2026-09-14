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

const words = (s) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

export function jaccard(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const FILE_TOOLS = new Set(["Read", "Edit", "Write"]);

export function redoCandidates(all) {
  const out = [];
  const toolsBy = bySession(all.tools.filter((t) => t.lane === "main"));

  // 1. After a compaction, the same session re-reads three or more files it had already
  //    read or edited. Cost: the main lane's spend in the hour after the compaction.
  for (const c of all.compactions) {
    const tools = toolsBy.get(c.sessionId) || [];
    const ct = Date.parse(c.ts);
    const before = new Set(
      tools
        .filter((t) => t.file && FILE_TOOLS.has(t.name) && Date.parse(t.ts) < ct)
        .map((t) => t.file),
    );
    const after = tools.filter(
      (t) =>
        t.file && t.name === "Read" && Date.parse(t.ts) >= ct && Date.parse(t.ts) - ct <= 60 * MIN,
    );
    const overlap = [...new Set(after.map((t) => t.file))].filter((f) => before.has(f));
    if (overlap.length < 3) continue;
    const cost = sumBetween(
      all.usage,
      (ev) => ev.sessionId === c.sessionId && ev.lane === "main",
      ct,
      ct + 60 * MIN,
    );
    out.push({
      class: "redo",
      kind: "reread-after-compaction",
      sessionId: c.sessionId,
      repo: c.repo,
      ts: c.ts,
      window: { from: c.ts, to: new Date(ct + 60 * MIN).toISOString() },
      cost,
      evidence: {
        trigger: c.trigger,
        preTokens: c.preTokens,
        filesReReadCount: overlap.length,
        files: overlap.slice(0, 8),
      },
    });
  }

  // 2. Two Agent dispatches in one session with near-identical prompts. Cost: the later
  //    agent's reported totalTokens (the parent's toolUseResult), kept as agentTotal.
  const resultByToolUse = new Map(all.agentResults.map((r) => [r.toolUseId, r]));
  for (const [sessionId, tools] of toolsBy) {
    const agents = tools.filter((t) => t.name === "Agent" && t.prompt);
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const sim = jaccard(agents[i].prompt, agents[j].prompt);
        if (sim < 0.7) continue;
        const r = resultByToolUse.get(agents[j].id);
        const cost = { ...emptySum(), agentTotal: r ? r.totalTokens : 0 };
        out.push({
          class: "redo",
          kind: "duplicate-agent-prompt",
          sessionId,
          repo: agents[j].repo,
          ts: agents[j].ts,
          window: { from: agents[i].ts, to: agents[j].ts },
          cost,
          evidence: {
            similarity: Number(sim.toFixed(2)),
            first: agents[i].prompt.slice(0, 120),
            second: agents[j].prompt.slice(0, 120),
            agentType: agents[j].agentType,
            agentModel: agents[j].agentModel,
          },
        });
      }
    }
  }
  return out;
}
