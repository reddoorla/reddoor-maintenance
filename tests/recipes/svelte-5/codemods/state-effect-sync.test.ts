import { describe, it, expect } from "vitest";
import { stateEffectSyncToDerived } from "../../../../src/recipes/svelte-5/codemods/state-effect-sync.js";

describe("codemod: $state + $effect sync → $derived", () => {
  it("rewrites the canonical caltex pattern", () => {
    const input = `<script>
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => { data; content = data.page.data });
</script>`;
    const out = stateEffectSyncToDerived(input);
    expect(out).toContain("let content = $derived(data.page.data);");
    expect(out).not.toContain("$state(data.page.data)");
    expect(out).not.toMatch(/\$effect\(\(\)\s*=>\s*\{\s*data;\s*content/);
  });

  it('works inside <script lang="ts">', () => {
    const input = `<script lang="ts">
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => { data; content = data.page.data });
</script>`;
    const out = stateEffectSyncToDerived(input);
    expect(out).toContain("let content = $derived(data.page.data);");
  });

  it("preserves surrounding code", () => {
    const input = `<script lang="ts">
  import foo from "bar";
  let { data } = $props();
  let viewpoortWidth = $state(1024);
  let content = $state(data.page.data);
  $effect(() => { data; content = data.page.data });

  function handleClick() { console.log("hi"); }
</script>

<div>{content.title}</div>`;
    const out = stateEffectSyncToDerived(input);
    expect(out).toContain('import foo from "bar";');
    expect(out).toContain("let viewpoortWidth = $state(1024);");
    expect(out).toContain("let content = $derived(data.page.data);");
    expect(out).toContain("function handleClick()");
    expect(out).toContain("<div>{content.title}</div>");
  });

  it("does not transform when initial and effect expressions differ", () => {
    const input = `<script>
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => { data; content = data.page.fallback });
</script>`;
    // Expressions differ — preserve as-is; intent unclear.
    expect(stateEffectSyncToDerived(input)).toBe(input);
  });

  it("does not transform when there is intervening code between state and effect", () => {
    const input = `<script>
  let { data } = $props();
  let content = $state(data.page.data);
  doSomethingElse();
  $effect(() => { data; content = data.page.data });
</script>`;
    expect(stateEffectSyncToDerived(input)).toBe(input);
  });

  it("tolerates extra whitespace and trailing semicolons", () => {
    const input = `<script>
  let { data } = $props();
  let content   =   $state( data.page.data ) ;
  $effect(  ()  =>  {  data ;  content  =  data.page.data  }  ) ;
</script>`;
    const out = stateEffectSyncToDerived(input);
    expect(out).toContain("let content = $derived(data.page.data);");
  });

  it("transforms multiple independent occurrences in one file", () => {
    const input = `<script>
  let { data, ctx } = $props();
  let a = $state(data.x);
  $effect(() => { data; a = data.x });
  let b = $state(ctx.y);
  $effect(() => { ctx; b = ctx.y });
</script>`;
    const out = stateEffectSyncToDerived(input);
    expect(out).toContain("let a = $derived(data.x);");
    expect(out).toContain("let b = $derived(ctx.y);");
  });

  it("is idempotent (re-running on output is a noop)", () => {
    const input = `<script>
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => { data; content = data.page.data });
</script>`;
    const once = stateEffectSyncToDerived(input);
    const twice = stateEffectSyncToDerived(once);
    expect(twice).toBe(once);
  });

  it("leaves files without the pattern unchanged", () => {
    const input = `<script>
  let { data } = $props();
  $effect(() => { console.log(data); });
</script>`;
    expect(stateEffectSyncToDerived(input)).toBe(input);
  });

  it("handles the multi-line $effect form with trailing semicolons inside the block", () => {
    const input = `<script lang="ts">
  let { data } = $props();

  let content = $state(data.page.data);
  $effect(() => {
    data;
    content = data.page.data;
  });
</script>`;
    const out = stateEffectSyncToDerived(input);
    expect(out).toContain("let content = $derived(data.page.data);");
    expect(out).not.toMatch(/\$state\(data\.page\.data\)/);
    expect(out).not.toMatch(/\$effect\(\(\)\s*=>\s*\{[\s\S]*?content\s*=\s*data\.page\.data/);
  });

  it("does not match when the effect references a different variable name", () => {
    const input = `<script>
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => { data; somethingElse = data.page.data });
</script>`;
    expect(stateEffectSyncToDerived(input)).toBe(input);
  });
});
