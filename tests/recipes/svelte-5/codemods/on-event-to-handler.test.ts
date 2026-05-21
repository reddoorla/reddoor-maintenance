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

  it("does not touch unrelated on: attributes (e.g. on:custom with modifier)", () => {
    const input = `<button on:click|preventDefault={fn} />`;
    const out = onEventToHandler(input);
    expect(out).toBe(input);
  });
});
