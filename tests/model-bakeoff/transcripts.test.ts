import { describe, it, expect } from "vitest";
import { readAgentTranscript } from "../../scripts/model-bakeoff/lib/transcripts.mjs";
import { verifyRan } from "../../scripts/model-bakeoff/bakeoff.mjs";

const user = (text: string) => JSON.stringify({ message: { role: "user", content: text } });
const assistant = (id: string, content: unknown[], effort = "low", model = "claude-haiku-5-5") =>
  JSON.stringify({
    effort,
    message: {
      id,
      model,
      role: "assistant",
      content,
      usage: { input_tokens: 1, output_tokens: 2 },
    },
  });
const bash = (command: string) => ({ type: "tool_use", name: "Bash", input: { command } });

describe("readAgentTranscript", () => {
  const text = [
    user("do the census\n\n(BAKEOFF-ARM: haiku-low-1)"),
    assistant("m1", [bash("wc -l /x/scripts/*")]),
    assistant("m1", [bash("wc -l /x/scripts/*")]),
    assistant("m2", [{ type: "tool_use", name: "StructuredOutput", input: { scripts: [] } }]),
  ].join("\n");

  it("reads the arm, what ran, and the structured output, counting each message once", () => {
    const t = readAgentTranscript(text);
    expect(t.marker).toEqual({ kind: "arm", id: "haiku-low-1" });
    expect(t.structured).toEqual({ scripts: [] });
    expect(t.models).toEqual(["claude-haiku-5-5"]);
    expect(t.efforts).toEqual(["low"]);
    expect(t.requests).toBe(2);
    expect(t.repeats).toBe(1);
    expect(t.forbidden).toEqual([]);
  });

  it("takes the last structured output the harness accepted, not one it rejected", () => {
    const rejected = JSON.stringify({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "late", is_error: true, content: "bad" }],
      },
    });
    const out = (id: string, ok: number) => ({
      type: "tool_use",
      id,
      name: "StructuredOutput",
      input: { ok },
    });
    const t = readAgentTranscript(
      [
        user("(BAKEOFF-ARM: a)"),
        assistant("m1", [out("early", 1)]),
        assistant("m2", [out("late", 0)]),
        rejected,
      ].join("\n"),
    );
    expect(t.structured).toEqual({ ok: 1 });
  });

  it("flags gh, git push and write requests among the Bash commands", () => {
    const t = readAgentTranscript(
      [
        user("(BAKEOFF-REFEREE: 1)"),
        assistant("a", [bash("gh issue create -t x")]),
        assistant("b", [bash("cd /x && git push origin main")]),
        assistant("c", [bash("curl -s -X POST https://api.github.com/x")]),
        assistant("d", [bash("grep -c 'gh api' /x/scripts/land-prs.mjs")]),
      ].join("\n"),
    );
    expect(t.marker).toEqual({ kind: "referee", id: "1" });
    expect(t.forbidden).toHaveLength(3);
  });
});

describe("verifyRan", () => {
  const ran = readAgentTranscript(
    [user("(BAKEOFF-ARM: a)"), assistant("m", [], "xhigh", "claude-opus-5-5")].join("\n"),
  );

  it("reports a model or an effort the transcripts contradict", () => {
    expect(verifyRan({ id: "a", model: "opus", effort: "xhigh" }, ran)).toEqual([]);
    expect(verifyRan({ id: "a", model: "haiku", effort: "low" }, ran)).toEqual([
      "a: asked for claude-haiku-5-5, transcripts show claude-opus-5-5",
      "a: asked for effort low, transcripts show xhigh",
    ]);
  });
});
