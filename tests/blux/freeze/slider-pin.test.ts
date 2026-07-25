import { describe, it, expect } from "vitest";
import { parse, HTMLElement } from "node-html-parser";
import { pinSliders } from "../../../src/blux/freeze/slider-pin.js";

const slidesOf = (out: string) =>
  parse(out)
    .querySelector(".caslider")!
    .childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement);

describe("pinSliders", () => {
  it("forces the first slide visible and hides the siblings", () => {
    const html = `<div class="caslider"><div style="width:100%">a</div><div>b</div><div>c</div></div>`;
    const slides = slidesOf(pinSliders(html));
    expect(slides[0].getAttribute("style")).toContain("translateX(0%)");
    expect(slides[0].getAttribute("style")).not.toContain("display:none");
    expect(slides[1].getAttribute("style")).toContain("display:none");
    expect(slides[2].getAttribute("style")).toContain("display:none");
  });

  it("preserves the first slide's existing inline style", () => {
    const html = `<div class="caslider"><div style="width:100%">a</div><div>b</div></div>`;
    const slides = slidesOf(pinSliders(html));
    expect(slides[0].getAttribute("style")).toContain("width:100%");
  });

  it("is a no-op for a slider with no slides", () => {
    expect(pinSliders(`<div class="caslider"></div>`)).toContain('class="caslider"');
  });
});
