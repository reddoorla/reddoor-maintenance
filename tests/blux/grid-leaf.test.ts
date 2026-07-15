import { describe, it, expect } from "vitest";
import { parse, type HTMLElement } from "node-html-parser";
import {
  textRoleFromClass,
  headingLevel,
  mediaFromElement,
  readBgSizing,
  textLeafStyle,
  utilityStylesFromClass,
} from "../../src/blux/grid/leaf.js";

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
  it("reads a video asset id + offline CDN base from a <video> src", () => {
    const v = el(
      '<video src="https://dv4tl7yyk1zlp.cloudfront.net/site-1/c023afe4-996f.mp4" controls></video>',
    );
    expect(mediaFromElement(v)).toEqual({
      kind: "video",
      assetId: "c023afe4-996f",
      ext: "mp4",
      // base + assetId + "." + ext reconstructs the src → resolves offline.
      base: "https://dv4tl7yyk1zlp.cloudfront.net/site-1/",
      // only present attributes are captured (this <video> has `controls` only).
      playback: { controls: true },
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
  it("captures intrinsic width, aspect (data-og-ratio), and fit (background-size)", () => {
    // The shape Blux renders a foreground graphic in: the .ib.camediaload holder
    // carries an inline pixel width + background-size, and a child .mediaRatio div
    // carries the intrinsic height:width ratio as a percent in data-og-ratio.
    const holder = el(
      '<div class="ib img imgfit camediaload" data-ext="png" data-media="b035b800.png" style="width: 600px; background-position: center center; background-size: contain;"><div class="mediaRatio" data-og-ratio="11.91919191919192"></div></div>',
    );
    expect(mediaFromElement(holder)).toEqual({
      kind: "image",
      assetId: "b035b800",
      ext: "png",
      width: 600,
      aspect: 11.919,
      fit: "contain",
    });
  });
  it("reads fit: cover and rounds a fractional width", () => {
    const holder = el(
      '<div class="ib img imgfit camediaload" data-media="c1" style="width: 971.4px; background-size: cover;"><div class="mediaRatio" data-og-ratio="118.94953656024715"></div></div>',
    );
    expect(mediaFromElement(holder)).toEqual({
      kind: "image",
      assetId: "c1",
      width: 971,
      aspect: 118.95,
      fit: "cover",
    });
  });
  it("ignores a non-pixel width (percent/vw) — only px is a faithful intrinsic size", () => {
    const holder = el(
      '<div class="ib camediaload" data-media="e1" style="width: 100%; background-size: cover;"><div class="mediaRatio" data-og-ratio="56.25"></div></div>',
    );
    expect(mediaFromElement(holder)).toEqual({
      kind: "image",
      assetId: "e1",
      aspect: 56.25,
      fit: "cover",
    });
  });
  it("captures the holder's inline min-height (slider slides reserve their height)", () => {
    const holder = el(
      '<div class="blocks2 camediaload" data-bgmedia="1" data-media="s1" style="min-height: 80vh; background-size: cover;"></div>',
    );
    expect(mediaFromElement(holder)).toEqual({
      kind: "image",
      assetId: "s1",
      fit: "cover",
      minHeight: "80vh",
    });
  });
  it("omits fit when background-size is neither contain nor cover, and width when absent", () => {
    // A band-background holder (background-size: auto, no inline width) carries no
    // faithful foreground sizing — those fields stay absent.
    const holder = el(
      '<div class="ib camediaload" data-media="d1" style="background-size: auto;"></div>',
    );
    expect(mediaFromElement(holder)).toEqual({ kind: "image", assetId: "d1" });
  });
});

describe("readBgSizing (band background)", () => {
  it("keeps a corner-anchored auto accent's fit + position", () => {
    const bg = el('<div style="background-size: auto; background-position: right bottom;"></div>');
    expect(readBgSizing(bg)).toEqual({ fit: "auto", position: "right bottom" });
  });
  it("drops cover (render default) but keeps a non-center position", () => {
    const bg = el('<div style="background-size: cover; background-position: right center;"></div>');
    expect(readBgSizing(bg)).toEqual({ position: "right center" });
  });
  it("is empty for a centered cover background (all defaults)", () => {
    const bg = el(
      '<div style="background-size: cover; background-position: center center;"></div>',
    );
    expect(readBgSizing(bg)).toEqual({});
  });
  it("keeps contain", () => {
    expect(readBgSizing(el('<div style="background-size: contain;"></div>'))).toEqual({
      fit: "contain",
    });
  });
});

describe("utilityStylesFromClass", () => {
  it("decodes margin-N(r|l|t|b) utilities to margin-side percentages", () => {
    expect(utilityStylesFromClass("block-body text1 margin-20r")).toEqual({
      "margin-right": "20%",
    });
    expect(utilityStylesFromClass("margin-5l margin-10t margin-15b")).toEqual({
      "margin-left": "5%",
      "margin-top": "10%",
      "margin-bottom": "15%",
    });
  });
  it("ignores pd_* utilities (always duplicated inline) and non-matching classes", () => {
    expect(utilityStylesFromClass("block-title text5 pd_l8 pd_t0")).toEqual({});
    expect(utilityStylesFromClass("margin-r margin-20x margin20r")).toEqual({});
    expect(utilityStylesFromClass("")).toEqual({});
  });
});

describe("textLeafStyle", () => {
  it("keeps allowlisted inline props (color, padding, margin*) and drops the rest", () => {
    // The hero subtitle shape in the-pointe's export, plus non-allowlisted noise.
    const leaf = el(
      '<div class="block-subtitle text13" style="padding: 10px 0px 0px; color: rgb(255, 255, 255); font-size: 18px; text-align: left;">x</div>',
    );
    expect(textLeafStyle(leaf)).toEqual({
      padding: "10px 0px 0px",
      color: "rgb(255, 255, 255)",
    });
  });
  it("captures a heading's inline padding deviation", () => {
    const leaf = el('<h3 class="block-title text6" style="padding: 0px 0px 0px 8px">x</h3>');
    expect(textLeafStyle(leaf)).toEqual({ padding: "0px 0px 0px 8px" });
  });
  it("decodes margin utilities off the class when there is no inline twin", () => {
    const leaf = el('<div class="block-body text1 margin-20r">x</div>');
    expect(textLeafStyle(leaf)).toEqual({ "margin-right": "20%" });
  });
  it("lets an inline declaration win over a class utility on conflict", () => {
    const leaf = el('<div class="block-body text1 margin-20r" style="margin-right: 4px">x</div>');
    expect(textLeafStyle(leaf)).toEqual({ "margin-right": "4px" });
  });
  it("returns null when the leaf carries neither", () => {
    expect(textLeafStyle(el('<div class="block-body text1">x</div>'))).toBeNull();
    expect(
      textLeafStyle(el('<div class="block-body" style="font-weight: bold">x</div>')),
    ).toBeNull();
  });
  it("normalizes uppercase/whitespace-padded inline declarations", () => {
    const leaf = el('<div class="block-body text1" style="COLOR : red">x</div>');
    expect(textLeafStyle(leaf)).toEqual({ color: "red" });
  });
  it("leaks no fragments of a non-allowlisted declaration whose value embeds colons/semicolons", () => {
    const leaf = el(
      '<div class="block-body text1" style="background-image: url(data:image/png;base64,xyz)">x</div>',
    );
    expect(textLeafStyle(leaf)).toBeNull();
  });
});

describe("mediaFromElement — video sizing/playback", () => {
  it("reads the intrinsic aspect off a percent-suffixed data-og-ratio holder", () => {
    const holder = el(
      '<div class="ib" data-og-ratio="56.25%"><video src="https://cdn/site/v1.mp4" controls playsinline></video></div>',
    );
    const m = mediaFromElement(holder);
    expect(m?.kind).toBe("video");
    expect(m?.aspect).toBe(56.25);
    expect(m?.playback).toEqual({ controls: true, playsinline: true });
  });
  it("reads aspect off a sibling .mediaRatio padding-bottom", () => {
    const holder = el(
      '<div class="block-holder"><div class="mediaRatio" style="padding-bottom: 42%"></div><video src="https://cdn/site/v2.mp4"></video></div>',
    );
    expect(mediaFromElement(holder)?.aspect).toBe(42);
  });
  it("captures all present playback flags, none when the video is bare", () => {
    const on = el('<video src="https://cdn/s/a.mp4" autoplay loop muted playsinline></video>');
    expect(mediaFromElement(on)?.playback).toEqual({
      playsinline: true,
      autoplay: true,
      loop: true,
      muted: true,
    });
    const bare = el('<video src="https://cdn/s/b.mp4"></video>');
    expect(mediaFromElement(bare)?.playback).toBeUndefined();
    expect(mediaFromElement(bare)?.aspect).toBeUndefined();
  });
});
