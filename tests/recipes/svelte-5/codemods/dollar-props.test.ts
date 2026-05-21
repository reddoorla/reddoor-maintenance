import { describe, it, expect } from "vitest";
import { exportLetToProps } from "../../../../src/recipes/svelte-5/codemods/dollar-props.js";

describe("codemod: export let → $props()", () => {
  it("rewrites a single export let", () => {
    const input = `<script lang="ts">
  export let name: string;
</script>`;
    const out = exportLetToProps(input);
    expect(out).toContain(`let { name }: { name: string } = $props();`);
    expect(out).not.toContain(`export let`);
  });

  it("rewrites multiple export let into one $props() destructuring", () => {
    const input = `<script lang="ts">
  export let name: string;
  export let age: number;
</script>`;
    const out = exportLetToProps(input);
    expect(out).toContain(`let { name, age }: { name: string; age: number } = $props();`);
  });

  it("handles export let with default values", () => {
    const input = `<script lang="ts">
  export let label: string = "go";
</script>`;
    const out = exportLetToProps(input);
    expect(out).toContain(`let { label = "go" }: { label?: string } = $props();`);
  });

  it("does nothing when there are no export let declarations", () => {
    const input = `<script lang="ts">
  const x = 1;
</script>`;
    expect(exportLetToProps(input)).toBe(input);
  });
});
