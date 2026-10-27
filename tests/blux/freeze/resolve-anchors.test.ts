import { describe, it, expect } from "vitest";
import { resolveAnchors } from "../../../src/blux/freeze/resolve-anchors.js";

describe("resolveAnchors", () => {
  it("bakes /#N to Blux core's #page-block-N when unmeasured", () => {
    const html =
      `<a class="data-hashlink" href="/#1">About</a>` +
      `<a class="data-hashlink" href="/#5">Team</a>`;
    const out = resolveAnchors(html);
    expect(out).toContain('href="#page-block-1"');
    expect(out).toContain('href="#page-block-5"');
    expect(out).not.toContain('href="/#');
  });

  it("prefers the measured answer key — custom scripts can send a link anywhere", () => {
    // the-pointe: an embedded custom script sends "Contact Us" to footer0,
    // recorded by settle's click audit.
    const html =
      `<a class="data-hashlink" href="/#1">Vision</a>` +
      `<a class="data-hashlink" href="/#11">Contact Us</a>`;
    const out = resolveAnchors(html, {
      "1": "page-block-1",
      "11": "footer0",
    });
    expect(out).toContain('href="#page-block-1"');
    expect(out).toContain('href="#footer0"');
  });

  it("leaves named anchors, roots, and external urls alone", () => {
    const html =
      `<a href="#site-icon-left">x</a><a href="/">y</a>` +
      `<a href="https://example.com/#5">z</a><a href="/#about">w</a>`;
    expect(resolveAnchors(html, { "5": "nope" })).toBe(html);
  });
});
