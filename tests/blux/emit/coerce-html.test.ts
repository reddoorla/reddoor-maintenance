import { describe, it, expect } from "vitest";
import { coerceHeadingHtml, demoteHeadingsHtml } from "../../../src/blux/emit/coerce-html.js";

describe("coerceHeadingHtml", () => {
  it("keeps an allowed heading tag", () => {
    expect(coerceHeadingHtml("<h2>Hi</h2>", ["h1", "h2"])).toBe("<h2>Hi</h2>");
  });
  it("clamps a disallowed heading to the nearest allowed level", () => {
    expect(coerceHeadingHtml('<h5 class="x">Hi</h5>', ["h2", "h3"])).toBe('<h3 class="x">Hi</h3>');
    expect(coerceHeadingHtml("<h1>Hi</h1>", ["h3", "h4"])).toBe("<h3>Hi</h3>");
  });
  it("promotes a paragraph to the lowest allowed heading", () => {
    expect(coerceHeadingHtml("<p>Hi</p>", ["h1", "h2"])).toBe("<h2>Hi</h2>");
  });
  it("wraps bare text in the target tag", () => {
    expect(coerceHeadingHtml("Hi", ["h2", "h3"])).toBe("<h3>Hi</h3>");
  });
  it("keeps only the first block for single fields", () => {
    expect(coerceHeadingHtml("<h2>One</h2><p>Two</p>", ["h2", "h3"])).toBe("<h2>One</h2>");
  });
});

describe("demoteHeadingsHtml", () => {
  it("rewrites heading tags to paragraphs, preserving attributes and inline markup", () => {
    expect(demoteHeadingsHtml('<h3 class="x">A <strong>b</strong></h3><p>c</p>')).toBe(
      '<p class="x">A <strong>b</strong></p><p>c</p>',
    );
  });
});
