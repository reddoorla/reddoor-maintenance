import { describe, it, expect } from "vitest";
import { removeDollarRestProps } from "../../../../src/recipes/svelte-5/codemods/dollar-restprops";

describe("codemod: $$restProps → rest in $props()", () => {
  it("replaces a $$restProps reference with rest", () => {
    const input = `<div {...$$restProps}>x</div>`;
    expect(removeDollarRestProps(input)).toBe(`<div {...rest}>x</div>`);
  });

  it("removes a $$Props interface declaration", () => {
    const input = `<script lang="ts">
  interface $$Props { name: string }
  const x = 1;
</script>`;
    const out = removeDollarRestProps(input);
    expect(out).not.toContain("$$Props");
    expect(out).toContain("const x = 1;");
  });

  it("is a noop when neither $$restProps nor $$Props appear", () => {
    const input = `<div>plain</div>`;
    expect(removeDollarRestProps(input)).toBe(input);
  });
});
