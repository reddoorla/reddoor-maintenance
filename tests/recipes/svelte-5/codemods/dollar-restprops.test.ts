import { describe, it, expect } from "vitest";
import { removeDollarRestProps } from "../../../../src/recipes/svelte-5/codemods/dollar-restprops.js";

describe("codemod: $$restProps → rest in $props()", () => {
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

  it("removes a $$Props interface with nested braces in the type body", () => {
    const input = `<script lang="ts">
  interface $$Props { config: { nested: { deeply: string } }; name: string }
  const x = 1;
</script>`;
    const out = removeDollarRestProps(input);
    expect(out).not.toContain("$$Props");
    expect(out).toContain("const x = 1;");
  });

  it("removes a $$Props interface that spans multiple lines", () => {
    const input = `<script lang="ts">
  interface $$Props {
    name: string;
    handlers: {
      onClick: () => void;
      onChange: (v: string) => void;
    };
  }
  const x = 1;
</script>`;
    const out = removeDollarRestProps(input);
    expect(out).not.toContain("$$Props");
    expect(out).toContain("const x = 1;");
  });

  it("injects ...rest into an existing JS $props() destructuring when $$restProps is used", () => {
    const input = `<script>
  let { name } = $props();
</script>
<div {...$$restProps}>{name}</div>`;
    const out = removeDollarRestProps(input);
    expect(out).toContain("let { name, ...rest } = $props();");
    expect(out).toContain("{...rest}");
    expect(out).not.toContain("$$restProps");
  });

  it("injects ...rest into an existing TS $props() destructuring and widens the type", () => {
    const input = `<script lang="ts">
  let { name }: { name: string } = $props();
</script>
<div {...$$restProps}>{name}</div>`;
    const out = removeDollarRestProps(input);
    expect(out).toContain("...rest");
    expect(out).toContain("$props()");
    // type must allow arbitrary excess props so the spread actually forwards
    // attrs (without widening, `rest` would be typed as {} and forward nothing).
    expect(out).toMatch(/\[key: string\]:\s*unknown/);
    expect(out).toContain("{...rest}");
    expect(out).not.toContain("$$restProps");
  });

  it("is idempotent — leaves an already-rest-destructured $props() alone", () => {
    const input = `<script>
  let { name, ...rest } = $props();
</script>
<div {...$$restProps}>{name}</div>`;
    const out = removeDollarRestProps(input);
    // exactly one `...rest` in the script (no double-insert)
    const scriptMatch = out.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();
    const scriptBody = scriptMatch![1]!;
    const restCount = (scriptBody.match(/\.\.\.rest\b/g) ?? []).length;
    expect(restCount).toBe(1);
    expect(out).toContain("{...rest}");
    expect(out).not.toContain("$$restProps");
  });

  it("preserves $$restProps inside string literals in the script", () => {
    const input = `<script>
  const note = "$$restProps was removed in Svelte 5";
  let { name } = $props();
</script>
<div {...$$restProps}>{name}</div>`;
    const out = removeDollarRestProps(input);
    // the literal string is untouched
    expect(out).toContain(`"$$restProps was removed in Svelte 5"`);
    // but the template usage still got rewritten + $props() got rest injected
    expect(out).toContain("let { name, ...rest } = $props();");
    expect(out).toContain("{...rest}");
  });

  it("leaves $$restProps untouched when no $props() call exists (no broken code)", () => {
    // Rare edge case: a Svelte 4 component that used $$restProps but had no
    // export let to convert. We refuse to fabricate a $props() declaration;
    // user sees the original $$restProps and a clear Svelte 5 error.
    const input = `<div {...$$restProps}>nothing</div>`;
    const out = removeDollarRestProps(input);
    expect(out).toBe(input);
  });
});
