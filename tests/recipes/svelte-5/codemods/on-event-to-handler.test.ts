import { describe, it, expect } from "vitest";
import { onEventToHandler } from "../../../../src/recipes/svelte-5/codemods/on-event-to-handler.js";

describe("codemod: on:event → onevent", () => {
  it("rewrites a simple on:click", () => {
    const input = `<button on:click={fn}>x</button>`;
    expect(onEventToHandler(input)).toBe(`<button onclick={fn}>x</button>`);
  });

  it("rewrites on:input with shorthand value", () => {
    const input = `<input on:input={(e) => handle(e)} />`;
    expect(onEventToHandler(input)).toBe(`<input oninput={(e) => handle(e)} />`);
  });

  it("does not touch event names inside script tags", () => {
    const input = `<script>const s = "on:click";</script><button on:click={fn} />`;
    const out = onEventToHandler(input);
    expect(out).toContain(`const s = "on:click";`);
    expect(out).toContain(`onclick={fn}`);
  });

  it("preserves the on:click|modifier attribute but emits an @migration-task marker", () => {
    // Svelte 5 removed event modifier syntax entirely. The rewrite is
    // non-trivial (`on:click|preventDefault` → `onclick={(e) => { e.preventDefault(); ... }}`)
    // so we don't attempt it automatically — but we MUST flag the line so
    // the user doesn't silently ship a Svelte 5 build error.
    const input = `<button on:click|preventDefault={fn}>x</button>`;
    const out = onEventToHandler(input);
    expect(out).toContain("@migration-task");
    expect(out).toMatch(/event modifier|on:[a-z]+\|/);
    // The original attribute is preserved verbatim — manual rewrite needed.
    expect(out).toContain("on:click|preventDefault={fn}");
  });

  it("emits one @migration-task per modifier site (multiple modifiers all flagged)", () => {
    const input = `<button on:click|preventDefault={a}>1</button>
<form on:submit|stopPropagation={b}>2</form>`;
    const out = onEventToHandler(input);
    const markers = (out.match(/@migration-task/g) ?? []).length;
    expect(markers).toBe(2);
  });

  it("does NOT emit @migration-task on a vanilla on:click without modifier", () => {
    const input = `<button on:click={fn}>x</button>`;
    const out = onEventToHandler(input);
    expect(out).not.toContain("@migration-task");
  });

  it("is idempotent — running on already-flagged output adds no new markers", () => {
    const input = `<button on:click|preventDefault={fn}>x</button>`;
    const once = onEventToHandler(input);
    const twice = onEventToHandler(once);
    expect(twice).toBe(once);
  });
});
