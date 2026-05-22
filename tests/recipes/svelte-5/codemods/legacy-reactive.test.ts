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

  it("works inside <script lang='ts'> too", () => {
    const input = `<script lang="ts">
  let viewportHeight: number = 0;
  $: fillHeight = viewportHeight > 100;
</script>`;
    const out = legacyReactiveToRunes(input);
    expect(out).toContain("let fillHeight = $derived(viewportHeight > 100);");
  });
});
