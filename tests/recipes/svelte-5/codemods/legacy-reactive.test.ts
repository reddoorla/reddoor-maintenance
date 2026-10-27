import { describe, it, expect } from "vitest";
import { legacyReactiveToRunes } from "../../../../src/recipes/svelte-5/codemods/legacy-reactive.js";

describe("codemod: $: reactive statements → $derived / $effect", () => {
  it("converts simple $: var = expr to let var = $derived(expr)", () => {
    const input = `<script lang="ts">
  let viewportHeight: number;
  let viewportWidth: number;
  $: fillHeight = viewportHeight * 16 > viewportWidth * 9;
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("let fillHeight = $derived(viewportHeight * 16 > viewportWidth * 9);");
    expect(out).not.toMatch(/^\s*\$:/m);
  });

  it("preserves indentation on the $derived line", () => {
    const input = `<script>
\t$: x = a + b;
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("\tlet x = $derived(a + b);");
  });

  it("handles $: x = expr without trailing semicolon", () => {
    const input = `<script>
  $: x = a + b
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("let x = $derived(a + b);");
  });

  it("converts $: { block } to $effect(() => { block })", () => {
    const input = `<script>
  let justify = "center";
  $: {
    justify = float;
    if (float === "left") justify = "start";
  }
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("$effect(() => {");
    expect(out).toContain("justify = float;");
    expect(out).toContain('if (float === "left") justify = "start";');
    expect(out).toMatch(/\}\)\s*;/);
    expect(out).not.toMatch(/^\s*\$:\s*\{/m);
  });

  it("converts $: { block } with no space between $: and {", () => {
    const input = `<script>
  $:{
    a = b;
    c = d;
  }
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("$effect(() => {");
    expect(out).toContain("a = b;");
    expect(out).toContain("c = d;");
  });

  it("handles nested braces inside a $: { } block", () => {
    const input = `<script>
  $: {
    if (cond) { doX(); }
    fn({ key: value });
  }
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("$effect(() => {");
    expect(out).toContain("if (cond) { doX(); }");
    expect(out).toContain("fn({ key: value });");
    // Outer wrapper should close exactly once
    const effectMatches = out.match(/\$effect\(/g) ?? [];
    expect(effectMatches).toHaveLength(1);
  });

  it("transforms multiple $: statements in one script", () => {
    const input = `<script>
  $: a = x;
  $: b = y;
  $: {
    c = z;
  }
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("let a = $derived(x);");
    expect(out).toContain("let b = $derived(y);");
    expect(out).toContain("$effect(() => {");
    expect(out).toContain("c = z;");
  });

  it("only touches $: at start of a line (not inside expressions or strings)", () => {
    const input = `<script>
  const url = "https://example.com";
  const obj = { $: 1 };
  let foo = "$: not a reactive statement";
  $: real = x;
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain('"https://example.com"');
    expect(out).toContain("{ $: 1 }");
    expect(out).toContain('"$: not a reactive statement"');
    expect(out).toContain("let real = $derived(x);");
  });

  it("does nothing to files with no $: statements", () => {
    const input = `<script>
  let x = 1;
  let y = $state(2);
</script>`;
    expect(legacyReactiveToRunes(input)).toBe(input);
  });

  it("is idempotent — re-running on output is a noop", () => {
    const input = `<script>
  $: fillHeight = a > b;
  $: {
    c = d;
  }
</script>`;
    const once = legacyReactiveToRunes(input);
    const twice = legacyReactiveToRunes(once);
    expect(twice).toBe(once);
  });

  it("emits an @migration-task marker on each converted $: { block } so users can audit reactivity", () => {
    const input = `<script>
  let justify = "center";
  $: {
    justify = float;
    if (float === "left") justify = "start";
  }
</script>`;
    const out = legacyReactiveToRunes(input);
    // marker sits on its own line, immediately before the $effect
    const markerBeforeEffect = /\/\/\s*@migration-task[^\n]*\n[ \t]*\$effect\(\(\)\s*=>\s*\{/;
    expect(out).toMatch(markerBeforeEffect);
    // marker should mention the actual risk so users know what to look for
    expect(out).toMatch(/\$state\b/);
  });

  it("does NOT emit @migration-task for simple $: var = expr conversions (those are reactive-safe)", () => {
    const input = `<script>
  $: x = a + b;
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).not.toContain("@migration-task");
    expect(out).toContain("let x = $derived(a + b);");
  });

  it("emits a separate @migration-task marker for each block when multiple appear", () => {
    const input = `<script>
  $: {
    a = b;
  }
  $: {
    c = d;
  }
</script>`;
    const out = legacyReactiveToRunes(input);
    const markerCount = (out.match(/@migration-task/g) ?? []).length;
    expect(markerCount).toBe(2);
  });

  it("works inside <script lang='ts'> too", () => {
    const input = `<script lang="ts">
  let viewportHeight: number = 0;
  $: fillHeight = viewportHeight > 100;
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("let fillHeight = $derived(viewportHeight > 100);");
  });

  // Regression class identified in tonight's 2026-05-27 deep review:
  // findMatchingClose counts braces but ignored comments, so a `}` inside a
  // `// line comment` or `/* block comment */` was counted toward the depth
  // counter. Result: either consume code AFTER the reactive block (depth
  // reaches 0 too early) OR drop code from INSIDE the block (matching brace
  // miscounted). The corrupted output compiles cleanly because Svelte is
  // lenient — there's no parser error to signal the corruption.
  it("handles `}` inside a line comment without misclosing the block", () => {
    const input = `<script>
  let count = 0;
  $: {
    // closing brace: }
    count = count + 1;
  }
  let after = "must survive";
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain('let after = "must survive";');
    // The `count = ...` line must be INSIDE the converted $effect body, not
    // orphaned after a truncated block (which is what the buggy version would
    // produce — depth reaches 0 at the comment's `}`, the real assignment ends
    // up floating in the trailing source).
    expect(out).toMatch(/\$effect\(\(\) => \{[\s\S]*count = count \+ 1;[\s\S]*\}\);/);
  });

  it("handles `}` inside a block comment without misclosing the block", () => {
    const input = `<script>
  let count = 0;
  $: {
    /* this block comment has a brace: } and a nested { for fun */
    count = count + 1;
  }
  let after = "must survive";
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain('let after = "must survive";');
    expect(out).toMatch(/\$effect\(\(\) => \{[\s\S]*count = count \+ 1;[\s\S]*\}\);/);
  });

  it("handles `{` inside a line comment without overrunning the block", () => {
    // The other direction: a stray `{` in a comment would inflate depth and
    // make findMatchingClose walk past the real closing brace, eating code
    // that follows.
    const input = `<script>
  let count = 0;
  $: {
    // opening brace: {
    count = count + 1;
  }
  let after = "must survive";
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("$effect(() =>");
    expect(out).toContain('let after = "must survive";');
    // The migration marker should appear EXACTLY once — if depth was inflated,
    // findMatchingClose would have returned -1 and the block wouldn't convert.
    const markerCount = (out.match(/@migration-task/g) ?? []).length;
    expect(markerCount).toBe(1);
  });
});
