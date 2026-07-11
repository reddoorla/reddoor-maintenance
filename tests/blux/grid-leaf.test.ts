import { describe, it, expect } from "vitest";
import { parse, type HTMLElement } from "node-html-parser";
import { textRoleFromClass, headingLevel, mediaFromElement } from "../../src/blux/grid/leaf.js";

const el = (html: string) => parse(html).firstChild as HTMLElement;

describe("textRoleFromClass", () => {
  it("extracts the textN role token", () => {
    expect(textRoleFromClass("block-title text5")).toBe("text5");
    expect(textRoleFromClass("block-body text1 margin-20r")).toBe("text1");
    expect(textRoleFromClass("block-subtitle text13")).toBe("text13");
  });
  it("returns undefined when no role token is present", () => {
    expect(textRoleFromClass("block-title")).toBeUndefined();
    expect(textRoleFromClass("")).toBeUndefined();
  });
});

describe("headingLevel", () => {
  it("reads the level off an h1..h6 tag", () => {
    expect(headingLevel(el("<h1 class='block-title'>x</h1>"))).toBe(1);
    expect(headingLevel(el("<h5 class='block-title'>x</h5>"))).toBe(5);
  });
});

describe("mediaFromElement", () => {
  it("reads an image asset from a block-media-holder's camediaload child", () => {
    const holder = el(
      '<div class="block-media-holder ibb top grid-2-r20"><div class="ib img imgfit camediaload" data-ext="png" data-media="449cb545-61ab"></div></div>',
    );
    expect(mediaFromElement(holder)).toEqual({
      kind: "image",
      assetId: "449cb545-61ab",
      ext: "png",
    });
  });
  it("reads a video asset id from a <video> src", () => {
    const v = el(
      '<video src="https://dv4tl7yyk1zlp.cloudfront.net/site-1/c023afe4-996f.mp4" controls></video>',
    );
    expect(mediaFromElement(v)).toEqual({
      kind: "video",
      assetId: "c023afe4-996f",
      ext: "mp4",
    });
  });
  it("returns null when the element holds no media", () => {
    expect(mediaFromElement(el("<div class='block-content'>x</div>"))).toBeNull();
  });
  it("does not match a class that merely contains 'camediaload' as a substring", () => {
    const holder = el('<div class="notcamediaload-thing" data-media="x"></div>');
    expect(mediaFromElement(holder)).toBeNull();
  });
  it("strips a file extension from data-media so the assetId is a bare uuid", () => {
    const holder = el(
      '<div class="block-media-holder"><div class="camediaload" data-media="a37733d6-2c4f-f2397.jpg" data-ext="jpg"></div></div>',
    );
    expect(mediaFromElement(holder)).toEqual({
      kind: "image",
      assetId: "a37733d6-2c4f-f2397",
      ext: "jpg",
    });
  });
  it("captures data-base as Media.base for a camediaload image", () => {
    const el = parse(
      `<div class="ib img imgfit camediaload" data-ext="png" data-base="https://cdn.example/folder/" data-media="abc123.png"></div>`,
    ).firstChild as never;
    expect(mediaFromElement(el)).toEqual({
      kind: "image",
      assetId: "abc123",
      ext: "png",
      base: "https://cdn.example/folder/",
    });
  });
});
