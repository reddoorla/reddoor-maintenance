import { describe, it, expect } from "vitest";
import { dollarPropsClass } from "../../../../src/recipes/svelte-5/codemods/dollar-props-class.js";

describe("codemod: $$props.class → named `class` prop", () => {
  it("adds class to existing $props() destructuring and rewrites template", () => {
    const input = `<script lang="ts">
  let { foo } = $props();
</script>
<div class="other {$$props.class || ''}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain('let { foo, class: className = "" } = $props();');
    expect(out).toContain("{className || ''}");
    expect(out).not.toContain("$$props.class");
  });

  it("preserves and extends the existing TypeScript annotation", () => {
    const input = `<script lang="ts">
  let { foo }: { foo?: string } = $props();
</script>
<div class="{$$props.class}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain(
      'let { foo, class: className = "" }: { foo?: string; class?: string } = $props();',
    );
    expect(out).toContain("{className}");
  });

  it("works with empty destructuring and adds type annotation when present", () => {
    const input = `<script lang="ts">
  let { }: {} = $props();
</script>
<div class="{$$props.class}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain('let { class: className = "" }: { class?: string } = $props();');
  });

  it("handles trailing commas in the destructuring body", () => {
    const input = `<script lang="ts">
  let { foo, } = $props();
</script>
<div class="{$$props.class}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain('let { foo, class: className = "" } = $props();');
    expect(out).not.toContain(",,");
  });

  it("inserts `class` BEFORE a trailing rest element (rest must stay last)", () => {
    const input = `<script lang="ts">
  let { foo, ...rest } = $props();
</script>
<div class="other {$$props.class || ''}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain('let { foo, class: className = "", ...rest } = $props();');
    // The invalid ordering `...rest, class` (rest not last) must never be emitted.
    expect(out).not.toMatch(/\.\.\.[A-Za-z_$][\w$]*\s*,\s*class\s*:/);
    expect(out).toContain("{className || ''}");
  });

  it("inserts `class` before a rest element while extending the type annotation", () => {
    const input = `<script lang="ts">
  let { foo, ...rest }: { foo?: string; [key: string]: unknown } = $props();
</script>
<div class="{$$props.class}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain(
      'let { foo, class: className = "", ...rest }: { foo?: string; [key: string]: unknown; class?: string } = $props();',
    );
  });

  it("handles a rest-only destructuring (class goes before the rest)", () => {
    const input = `<script lang="ts">
  let { ...rest } = $props();
</script>
<div class="{$$props.class}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain('let { class: className = "", ...rest } = $props();');
  });

  it("preserves the `|| 'fallback'` pattern in the template", () => {
    const input = `<script lang="ts">
  let { foo } = $props();
</script>
<div class="{$$props.class || 'flex items-center'}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain("{className || 'flex items-center'}");
  });

  it("does not transform files that don't use $$props.class", () => {
    const input = `<script lang="ts">
  let { foo } = $props();
</script>
<div>{foo}</div>`;
    expect(dollarPropsClass(input)).toBe(input);
  });

  it("is a noop when $$props.class is already migrated (idempotent)", () => {
    const input = `<script lang="ts">
  let { foo, class: className = "" } = $props();
</script>
<div class="{className}">x</div>`;
    expect(dollarPropsClass(input)).toBe(input);
  });

  it("strips the @migration-task comments when no $$props uses remain after rewrite", () => {
    const input = `<!-- @migration-task Error while migrating Svelte code: $$props is used together with named props in a way that cannot be automatically migrated. -->
<!-- @migration-task Error while migrating Svelte code: $$props is used together with named props in a way that cannot be automatically migrated. -->
<script lang="ts">
  let { foo } = $props();
</script>
<div class="{$$props.class}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).not.toContain("@migration-task");
    expect(out).toContain('let { foo, class: className = "" } = $props();');
    expect(out).toContain("{className}");
  });

  it("leaves @migration-task comments in place if other $$props references remain", () => {
    const input = `<!-- @migration-task Error while migrating Svelte code: $$props is used together with named props in a way that cannot be automatically migrated. -->
<script lang="ts">
  let { foo } = $props();
</script>
<div class="{$$props.class}" data-other={$$props.someOther}>x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain("@migration-task");
    expect(out).toContain("$$props.someOther");
    expect(out).not.toContain("$$props.class");
  });

  it("does not touch $$props.class occurrences inside script blocks", () => {
    const input = `<script lang="ts">
  let { foo } = $props();
  console.log($$props.class);
</script>
<div>x</div>`;
    // Template has no $$props.class, but script does — conservative: leave file untouched
    // (script-side $$props is a separate concern; this codemod is template-focused)
    const out = dollarPropsClass(input);
    expect(out).toContain("console.log($$props.class)");
  });

  it("handles default values that contain braces (e.g., `() => {}`)", () => {
    const input = `<script lang="ts">
  let { click = ()=>{}, filled = true }: { click?: unknown; filled?: unknown } = $props();
</script>
<button class="{$$props.class || ''}">x</button>`;
    const out = dollarPropsClass(input);
    expect(out).toContain(
      'let { click = ()=>{}, filled = true, class: className = "" }: { click?: unknown; filled?: unknown; class?: string } = $props();',
    );
    expect(out).toContain("{className || ''}");
  });

  it("handles object-literal default values", () => {
    const input = `<script lang="ts">
  let { config = { x: 1 } } = $props();
</script>
<div class="{$$props.class}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain('let { config = { x: 1 }, class: className = "" } = $props();');
  });

  it("plain <script> (no lang='ts') skips the type annotation", () => {
    const input = `<script>
  let { foo } = $props();
</script>
<div class="{$$props.class}">x</div>`;
    const out = dollarPropsClass(input);
    expect(out).toContain('let { foo, class: className = "" } = $props();');
    expect(out).not.toContain(": {");
    expect(out).toContain("{className}");
  });
});
