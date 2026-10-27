// Pure candidate finders over the walker's full collection. Every finder nominates;
// none confirms. Costs are the meter's counters summed over a stated window.
import { COUNTERS, add, emptySum } from "./aggregate.mjs";

// The two ways a subagent transcript records that the agent was KILLED rather than
// finished. See agentEndState in walk.mjs for the other two states and why neither is
// nominated: an unterminated file is what a live agent looks like too.
export const ORPHAN_END = new Set(["quota-rejected", "interrupted"]);

export const MIN = 60000;
// How long after a limit block a "contin…" prompt still counts as the resume of THAT
// block. The operator waits for the five-hour session window to reset, so the lag is
// hours: measured over the corpus's 243 blocks (n = 237) the minimum is 57 minutes, the
// median 212 and the maximum 1,312, and exactly one is inside an hour. Six hours is the
// reset plus slack — bounded deliberately, so the finder does not simply pair a block
// with any later "continue" the session ever contains.
export const CONTINUE_WINDOW_MIN = 6 * 60;
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

  // 2. A limit block, then a "continue" within CONTINUE_WINDOW_MIN: the re-orientation
  //    cost is the session's spend in the thirty minutes after the continue.
  //    One candidate per RESUME, not per block record: a single wall writes a block into
  //    every lane that hit it (the corpus's 243 blocks are 11 resumes, one of them
  //    nominated by 70 separate block records), so the resumes are keyed by the continue
  //    prompt and paired with the nearest block before it.
  const resumes = new Map();
  for (const b of all.blocks) {
    const prompts = promptsBy.get(b.sessionId) || [];
    const t = Date.parse(b.ts);
    const c = prompts.find((p) => {
      const pt = Date.parse(p.ts);
      return pt > t && pt - t <= CONTINUE_WINDOW_MIN * MIN && CONTINUE_RE.test(p.text);
    });
    if (!c) continue;
    const key = `${b.sessionId}\u0000${c.uuid || c.ts}`;
    const prev = resumes.get(key);
    if (prev) {
      prev.blocks += 1;
      if (t > Date.parse(prev.block.ts)) prev.block = b;
    } else {
      resumes.set(key, { block: b, continue: c, blocks: 1 });
    }
  }
  for (const r of resumes.values()) {
    const b = r.block;
    const c = r.continue;
    const t = Date.parse(b.ts);
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
      evidence: {
        block: b.kind,
        // kind "model" caps one model, not the account: name which, so the resume is not
        // read as a wait for the five-hour session reset.
        ...(b.model ? { model: b.model } : {}),
        blocks: r.blocks,
        prompt: c.text.slice(0, 120),
        lagMin: Math.round((ct - t) / MIN),
      },
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

  // 4. A subagent that was dispatched and never returned. The refuter rounds found that
  //    the cost of an account-limit block is not the resume but the agents in flight when
  //    the block landed, and the prompt-shaped heuristics cannot see them at all: the
  //    parent's tool_result for an async dispatch is written AT LAUNCH
  //    (toolUseResult.status "async_launched"), so "no tool_result" is not the tell. The
  //    tell is in the agent's OWN transcript: its last record is either the account limit
  //    answering for the model (quotaLimits.status "rejected") or a "[Request interrupted…]"
  //    record it never replied to. A completed task-notification in the parent overrides
  //    both — that agent returned however its file ends.
  //    Cost is the agent's own spend, deduped by requestId exactly as the meter does,
  //    with agentTotal the four counters added.
  const completed = new Set(
    (all.notifications || []).filter((n) => n.status === "completed").map((n) => n.agentId),
  );
  const usageByAgent = new Map();
  for (const ev of all.usage) {
    if (!ev.agentId) continue;
    let s = usageByAgent.get(ev.agentId);
    if (!s) usageByAgent.set(ev.agentId, (s = emptySum()));
    add(s, ev);
  }
  const dispatches = new Map();
  for (const a of all.agents || []) {
    if (!dispatches.has(a.sessionId)) dispatches.set(a.sessionId, []);
    dispatches.get(a.sessionId).push(a);
  }
  for (const arr of dispatches.values())
    arr.sort((x, y) => (x.spawnedAt < y.spawnedAt ? -1 : x.spawnedAt > y.spawnedAt ? 1 : 0));
  for (const a of all.agents || []) {
    if (!ORPHAN_END.has(a.lastStatus)) continue;
    if (completed.has(a.agentId)) continue;
    const sum = usageByAgent.get(a.agentId) || emptySum();
    const cost = { ...sum, agentTotal: sum.in + sum.out + sum.cacheCreate + sum.cacheRead };
    // The re-dispatch, if there was one. Matched on the dispatch DESCRIPTION being
    // byte-identical — the 2026-08-24 lenses were re-sent as "Review #569: security lens"
    // and so on, verbatim — not on prompt similarity, which would confuse a re-send with
    // a merely similar task. The nearest later dispatch wins.
    const again = (dispatches.get(a.sessionId) || []).find(
      (b) =>
        b.agentId !== a.agentId &&
        b.description &&
        b.description === a.description &&
        b.spawnedAt > a.spawnedAt,
    );
    out.push({
      class: "fanout",
      kind: "orphaned-agent",
      sessionId: a.sessionId,
      repo: a.repo,
      ts: a.spawnedAt,
      window: { from: a.spawnedAt, to: a.lastAt },
      cost,
      evidence: {
        agentId: a.agentId,
        toolUseId: a.toolUseId,
        description: a.description,
        agentType: a.agentType,
        spawnedAt: a.spawnedAt,
        lastAt: a.lastAt,
        lastStatus: a.lastStatus,
        redispatched: again ? again.toolUseId : null,
        // The re-dispatched agent's OWN first record, which is moments after the parent's
        // Agent call — near enough to place the re-send on the clock, and the only time
        // the agent row carries.
        redispatchedAt: again ? again.spawnedAt : null,
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

  // 2. An Agent dispatch whose prompt is near-identical to an EARLIER dispatch in the same
  //    session. Cost: that dispatch's reported totalTokens (the parent's toolUseResult),
  //    kept as agentTotal. One candidate per repeated dispatch, paired with its closest
  //    earlier match — a pairwise loop emitted one per (earlier, later) pair, so a single
  //    dispatch resembling three earlier ones became three candidates carrying the same
  //    agentTotal. `matches` keeps what that loop was really reporting: how many earlier
  //    prompts cleared the bar.
  const resultByToolUse = new Map(all.agentResults.map((r) => [r.toolUseId, r]));
  for (const [sessionId, tools] of toolsBy) {
    const agents = tools.filter((t) => t.name === "Agent" && t.prompt);
    for (let j = 1; j < agents.length; j++) {
      let best = null;
      let bestSim = 0;
      let matches = 0;
      for (let i = 0; i < j; i++) {
        const sim = jaccard(agents[i].prompt, agents[j].prompt);
        if (sim < 0.7) continue;
        matches += 1;
        if (sim > bestSim) {
          bestSim = sim;
          best = agents[i];
        }
      }
      if (!best) continue;
      const r = resultByToolUse.get(agents[j].id);
      const cost = { ...emptySum(), agentTotal: r ? r.totalTokens : 0 };
      out.push({
        class: "redo",
        kind: "duplicate-agent-prompt",
        sessionId,
        repo: agents[j].repo,
        ts: agents[j].ts,
        window: { from: best.ts, to: agents[j].ts },
        cost,
        evidence: {
          similarity: Number(bestSim.toFixed(2)),
          matches,
          first: best.prompt.slice(0, 120),
          second: agents[j].prompt.slice(0, 120),
          agentType: agents[j].agentType,
          agentModel: agents[j].agentModel,
        },
      });
    }
  }
  return out;
}

export function unreadCandidates(all) {
  const out = [];
  const promptsBy = bySession(all.prompts.filter((p) => p.lane === "main"));
  for (const [sessionId, prompts] of promptsBy) {
    for (let i = 1; i < prompts.length; i++) {
      const p = prompts[i];
      if (!CORRECTION_RE.test(p.text)) continue;
      const prev = prompts[i - 1];
      const from = Date.parse(prev.ts);
      const to = Date.parse(p.ts);
      const cost = sumBetween(all.usage, (ev) => ev.sessionId === sessionId, from, to);
      if (cost.requests === 0) continue;
      out.push({
        class: "unread",
        kind: "corrected-turn",
        sessionId,
        repo: p.repo,
        ts: p.ts,
        window: { from: prev.ts, to: p.ts },
        cost,
        evidence: {
          correction: p.text.slice(0, 200),
          precedingPrompt: prev.text.slice(0, 120),
          minutes: Math.round((to - from) / MIN),
        },
      });
    }
  }
  return out;
}
