/// <reference lib="dom" />
/**
 * The mobile-overflow check from the fleet's smoke specs, lifted out of the
 * sites' inline copies (reddoorla/reddoor-maintenance#1892) so it is fixed and
 * tested once. Taken from reddoorla/composition-hospitality
 * `tests/smoke/mobile-overflow.spec.ts` at 63f5fcb (#47, 2026-11-03), whose
 * body matches reddoorla/williamson-construction-co#46's but for the layout of
 * the returned object, with #1892's six findings fixed. Each fix has a fixture
 * in `tests/smoke/measure.test.ts` that turns red when the fix is reverted.
 *
 * Two assertions use it: the page is no wider than the screen
 * (`scrollWidth <= clientWidth`), and no text a visitor can see straddles the
 * right edge (`cut` is empty). Measure in a plain desktop context at the device
 * width: Chromium's mobile emulation zooms the page out to fit and hides the
 * overflow.
 *
 * Only text that straddles the edge counts: text wholly past it is a closed
 * menu or a carousel slide parked off-screen, not a cut. Text the browser does
 * not paint (hidden, or opacity 0), text inside an inert subtree (a carousel's
 * peeking slide), and a line the ancestors that clip it leave nothing of (the
 * sr-only pattern, a slider's parked slides) are skipped. A box the visitor can
 * scroll (overflow auto or scroll) hides nothing they can scroll to. A line a
 * box cuts inside the screen still counts when the line runs past the edge:
 * the visitor sees it cut mid-word.
 *
 * Not handled (#1892): closed shadow roots, `overflow-clip-margin`, text cut
 * at the left edge, and a scroll container whose own content straddles the
 * edge (a wide table in an `overflow-x: auto` wrapper is reported cut). The
 * inert skip is broad: a parked slide that is the only thing straddling the
 * edge, or on-screen content marked inert, is skipped too.
 */

export type OverflowMeasure = {
  /** `document.documentElement.scrollWidth`. */
  scrollWidth: number;
  /** `document.documentElement.clientWidth`: the screen's width. */
  clientWidth: number;
  /** One `<tag> "first 60 characters"` entry per text node cut at the right edge. */
  cut: string[];
};

/** What `measure` needs of a Playwright `Page`, so this module imports nothing. */
export type EvaluatingPage = {
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
};

/**
 * The check itself, run in the page. Self-contained, because Playwright sends
 * it to the page as source text: it may not reach anything outside its own
 * body.
 */
export function measureInPage(): OverflowMeasure {
  const vw = document.documentElement.clientWidth;
  const cut: string[] = [];
  // Whether a box forms a containing block for absolute and fixed
  // descendants other than by `position`: a transform in any of its forms,
  // filter or backdrop-filter, preserve-3d, paint/layout containment
  // (content-visibility: auto applies both), or will-change naming one.
  const formsBlock = (cs: CSSStyleDeclaration) =>
    cs.transform !== "none" ||
    cs.translate !== "none" ||
    cs.rotate !== "none" ||
    cs.scale !== "none" ||
    cs.perspective !== "none" ||
    cs.filter !== "none" ||
    cs.backdropFilter !== "none" ||
    cs.transformStyle === "preserve-3d" ||
    cs.contentVisibility === "auto" ||
    /paint|layout|strict|content/.test(cs.contain) ||
    /transform|translate|rotate|scale|perspective|filter/.test(cs.willChange);
  // The next box up in the flat tree: a slotted node climbs into its slot, and
  // a shadow tree's top climbs out to its host. (A closed shadow root hides
  // its slots from page script, so its clips are not seen.)
  const up = (a: Element): Element | null =>
    a.assignedSlot ??
    a.parentElement ??
    (a.parentNode instanceof ShadowRoot ? a.parentNode.host : null);
  // A plain inline box: inline, inline list-item, and ruby and its parts.
  // Overflow, containment and text-overflow do not apply to one, and of the
  // properties that make a containing block for fixed descendants only filter
  // and backdrop-filter do, set or named in will-change (#1892 findings 2 and
  // 3; transform, contain and will-change naming anything else do not,
  // checked against paint). An outer <svg> computes
  // display: inline too, but it is a replaced box and clips its content to
  // its own box (finding 4).
  const inlineFormsBlock = (cs: CSSStyleDeclaration) =>
    cs.filter !== "none" ||
    cs.backdropFilter !== "none" ||
    cs.willChange.split(",").some((v) => /^\s*(backdrop-)?filter\s*$/.test(v));
  const plainInline = (a: Element, cs: CSSStyleDeclaration) =>
    /^(inline|inline list-item|ruby(-.*)?)$/.test(cs.display) &&
    !(a instanceof SVGSVGElement && !a.ownerSVGElement);
  // The boxes that are not block containers, which alone take text-overflow:
  // a flex, grid, table or math container's own text sits in an anonymous
  // item that does not draw the container's ellipsis (finding 1). Listed by
  // exclusion, because Chromium serializes multi-keyword block containers
  // such as `flow-root list-item` as they are written. An anonymous block
  // beside a block child does draw the ellipsis, in Chromium: that part of
  // #1892's finding 1 did not hold against paint. -webkit-box and
  // -webkit-inline-box are laid out as flex boxes and draw none either; the
  // one exception, -webkit-line-clamp, makes display compute as flow-root.
  const notBlockContainer =
    /(^|[ -])(flex|grid|table|math)$|^table-(row|row-group|header-group|footer-group|column|column-group)$|^-webkit-(inline-)?box$/;
  // mask-image, and -webkit-mask-box-image with no outset, paint nothing
  // outside the border box (finding 6: a mask-box-image leaves mask-image at
  // none). mask-border, its standard name, is not in Chromium.
  const masksToBorderBox = (cs: CSSStyleDeclaration) =>
    cs.maskImage !== "none" ||
    (!/^(none)?$/.test(cs.getPropertyValue("-webkit-mask-box-image-source")) &&
      cs
        .getPropertyValue("-webkit-mask-box-image-outset")
        .split(" ")
        .every((v) => parseFloat(v) === 0));
  // A probe the clip-path insets are resolved on, so calc() and percentages
  // come out as the browser computes them (finding 5). Its box sits in a
  // shadow root under an `all: initial` host with inline !important styles, so
  // no page rule (`div:empty`, a padding reset) reaches it; fixed, so it adds
  // nothing to the page's scroll width; removed before the page width is
  // read. A MutationObserver on the document sees it come and go.
  const probe: { host?: HTMLElement; box?: HTMLElement; child?: HTMLElement } = {};
  // Whether a box or any box above it in the flat tree is drawn other than
  // by a positive, axis-aligned scale and a move: a mirror, a turn, a skew,
  // or a 3D transform, by transform or by the rotate and scale longhands.
  // Kept per box, since every line asks it of each of its ancestors.
  const turnedOf = new Map<Element, boolean>();
  const turned = (a: Element): boolean => {
    let t = turnedOf.get(a);
    if (t !== undefined) return t;
    const cs = getComputedStyle(a);
    const m = cs.transform === "none" ? null : new DOMMatrix(cs.transform);
    const parent = up(a);
    t =
      (m !== null && (!m.is2D || m.b !== 0 || m.c !== 0 || m.a < 0 || m.d < 0)) ||
      cs.rotate !== "none" ||
      /-/.test(cs.scale) ||
      (parent !== null && turned(parent));
    turnedOf.set(a, t);
    return t;
  };
  // Screen pixels per CSS pixel on a box, across and down. A rect is in
  // screen pixels, which zoom and a scaled ancestor make larger; offset,
  // client and scroll sizes, insets, margins, borders and paddings are CSS
  // pixels. An outer <svg> has no offset size, so its CSS size is read from
  // its computed style (review round 4). A turned box's rect bounds it
  // without measuring it, so there the ratio is 1, as in the site copy.
  const ratio = (a: Element, b: DOMRect): [number, number] => {
    if (turned(a)) return [1, 1];
    let [w, h] = [0, 0];
    if (a instanceof HTMLElement) [w, h] = [a.offsetWidth, a.offsetHeight];
    else if (a instanceof SVGSVGElement) {
      const cs = getComputedStyle(a);
      const px = (p: string) => parseFloat(cs.getPropertyValue(p)) || 0;
      const edge = (s: string) =>
        cs.boxSizing === "border-box" ? 0 : px(`padding-${s}`) + px(`border-${s}-width`);
      w = px("width") + edge("left") + edge("right");
      h = px("height") + edge("top") + edge("bottom");
    }
    return w > 0 && h > 0 ? [b.width / w, b.height / h] : [1, 1];
  };
  // The rect a clip-path inset() leaves of a box, or null for any other
  // shape, which leaves the line as it is. A negative inset reaches past the
  // box (`inset(0 -100vmax)`), as it does on screen. `round` is ignored, since
  // rounded corners only take more away.
  const insetRect = (a: Element, cs: CSSStyleDeclaration, b: DOMRect): number[] | null => {
    const m = /^inset\((.*)\)\s*([a-z-]*)$/.exec(cs.clipPath);
    if (!m) return null;
    const args: string[] = [];
    let [depth, word] = [0, ""];
    for (const ch of m[1]!) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === " " && depth === 0) {
        if (word) args.push(word);
        word = "";
      } else word += ch;
    }
    if (word) args.push(word);
    const round = args.indexOf("round");
    if (round >= 0) args.length = round;
    if (args.length < 1 || args.length > 4) return null;
    const [top, right = top, bottom = top, left = right] = args as [string, ...string[]];
    // The reference box: border-box unless named. fill-box, stroke-box and
    // view-box are the border box on a CSS box. `ratio` converts the CSS
    // pixels to the rect's. It does not hold where the box or an ancestor is
    // mirrored or turned: see `turned`.
    const [sx, sy] = ratio(a, b);
    const scale = (d: readonly number[]) => [d[0]! * sx, d[1]! * sx, d[2]! * sy, d[3]! * sy];
    const px = (p: string) => parseFloat(cs.getPropertyValue(p)) || 0;
    const sides = (f: (side: string) => number) => [f("left"), f("right"), f("top"), f("bottom")];
    const grow = (by: number[], sign: number) =>
      [-sign * by[0]!, sign * by[1]!, -sign * by[2]!, sign * by[3]!] as const;
    let r = [b.left, b.right, b.top, b.bottom];
    const add = (d: readonly number[]) => (r = r.map((v, i) => v + scale(d)[i]!));
    const box = m[2] || "border-box";
    if (box === "margin-box")
      add(
        grow(
          sides((s) => px(`margin-${s}`)),
          1,
        ),
      );
    if (box === "padding-box" || box === "content-box")
      add(
        grow(
          sides((s) => px(`border-${s}-width`)),
          -1,
        ),
      );
    if (box === "content-box")
      add(
        grow(
          sides((s) => px(`padding-${s}`)),
          -1,
        ),
      );
    if (!/^(margin|border|padding|content|fill|stroke|view)-box$/.test(box)) return null;
    if (!probe.host) {
      probe.host = document.createElement("measure-probe");
      probe.host.setAttribute(
        "style",
        "all:initial!important;display:block!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;visibility:hidden!important;pointer-events:none!important",
      );
      const root = probe.host.attachShadow({ mode: "open" });
      probe.box = root.appendChild(document.createElement("div"));
      probe.child = probe.box.appendChild(document.createElement("div"));
      document.documentElement.append(probe.host);
    }
    const [box0, child] = [probe.box!, probe.child!];
    box0.style.cssText = `position:absolute;left:0;top:0;margin:0;border:0;padding:0;box-sizing:content-box;width:${(r[1]! - r[0]!) / sx}px;height:${(r[3]! - r[2]!) / sy}px`;
    const resolve = (prop: "left" | "top", v: string) => {
      child.style.cssText = "position:absolute;margin:0";
      child.style.setProperty(prop, v);
      return parseFloat(getComputedStyle(child)[prop]);
    };
    const [l, rt, t, bt] = [
      resolve("left", left),
      resolve("left", right),
      resolve("top", top),
      resolve("top", bottom),
    ];
    if (![l, rt, t, bt].every(Number.isFinite)) return null;
    // A mirrored or turned box's insets fall on its own sides, not the
    // screen's (review round 2: scaleX(-1) with inset(0 0 0 50%) keeps the
    // half that paints at the screen's left). There the clip narrows only to
    // the border box, which holds all it can show, as the site copy did; a
    // margin box or a negative inset can reach past that, so it does not
    // narrow at all.
    if (turned(a)) {
      if (box === "margin-box" || Math.min(l, rt, t, bt) < 0) return null;
      return [b.left, b.right, b.top, b.bottom];
    }
    return [r[0]! + l * sx, r[1]! - rt * sx, r[2]! + t * sy, r[3]! - bt * sy];
  };
  // How far right a line box can be seen, or null when none of it can be seen
  // on the screen. Each ancestor that clips narrows the line, axis by axis:
  // overflow hidden and clip and paint containment show only the ancestor's
  // padding box, which leaves nothing of the sr-only pattern's 1px box or of a
  // slider's parked slides. auto and scroll let the visitor scroll anything in
  // the box's scrollable extent into view, so past one of those the line can
  // sit anywhere in its box. Overflow and containment do not apply to plain
  // inline boxes. A clipping ancestor only clips boxes whose containing block
  // it is or contains. display: contents boxes have no rect. The returned edge
  // is the line's own right edge, so text cut by a full-width clipping section
  // still fails, except where the line's own block container ends it in an
  // ellipsis (text-overflow, Tailwind's `truncate`): there the text ends where
  // the clip does.
  const seen = (start: Element, line: DOMRect): number | null => {
    let [x0, x1, y0, y1] = [line.left, line.right, line.top, line.bottom];
    let end = line.right;
    // The block container whose inline content the line is: the only box
    // whose text-overflow draws an ellipsis on it.
    let blockOf: Element | null = start;
    for (; blockOf; blockOf = up(blockOf)) {
      const cs = getComputedStyle(blockOf);
      if (cs.display !== "contents" && !plainInline(blockOf, cs)) break;
    }
    if (blockOf && notBlockContainer.test(getComputedStyle(blockOf).display)) blockOf = null;
    // An absolute box skips static ancestors up to its containing block; a
    // fixed box skips everything up to an ancestor that forms one by
    // transform, filter or containment (usually none: then nothing clips it).
    let escaped: "" | "absolute" | "fixed" = "";
    for (let a: Element | null = start; a && a !== document.body; a = up(a)) {
      const cs = getComputedStyle(a);
      if (cs.display === "contents") continue;
      const b = a.getBoundingClientRect();
      // clip-path and masks clip whatever they paint, out-of-flow boxes
      // included, so they apply on every ancestor.
      const clips = [insetRect(a, cs, b)];
      if (masksToBorderBox(cs)) clips.push([b.left, b.right, b.top, b.bottom]);
      for (const c of clips) {
        if (!c) continue;
        [x0, x1] = [Math.max(x0, c[0]!), Math.min(x1, c[1]!)];
        [y0, y1] = [Math.max(y0, c[2]!), Math.min(y1, c[3]!)];
      }
      const inline = plainInline(a, cs);
      const block = inline ? inlineFormsBlock(cs) : formsBlock(cs);
      const containing =
        escaped === "fixed"
          ? block
          : escaped === "absolute"
            ? cs.position !== "static" || block
            : true;
      if (containing && !inline) {
        escaped = "";
        // The padding box, which overflow and paint containment clip to, in
        // screen pixels (review round 3: under zoom it came out half wide).
        const [qx, qy] = ratio(a, b);
        const pl = b.left + a.clientLeft * qx;
        const pt = b.top + a.clientTop * qy;
        const [pr, pb] = [pl + a.clientWidth * qx, pt + a.clientHeight * qy];
        const scrolls = (o: string) => o === "auto" || o === "scroll";
        const paint = /paint|strict|content/.test(cs.contain) || cs.contentVisibility === "auto";
        const xBefore = x1;
        if (scrolls(cs.overflowX)) {
          const l = pl - a.scrollLeft * qx;
          if (Math.min(x1, l + a.scrollWidth * qx) - Math.max(x0, l) <= 1) return null;
          [x0, x1] = [pl, pr];
        } else if (cs.overflowX !== "visible" || paint) {
          [x0, x1] = [Math.max(x0, pl), Math.min(x1, pr)];
        }
        if (scrolls(cs.overflowY)) {
          const t = pt - a.scrollTop * qy;
          if (Math.min(y1, t + a.scrollHeight * qy) - Math.max(y0, t) <= 1) return null;
          [y0, y1] = [pt, pb];
        } else if (cs.overflowY !== "visible" || paint) {
          [y0, y1] = [Math.max(y0, pt), Math.min(y1, pb)];
        }
        if (
          a === blockOf &&
          cs.textOverflow !== "clip" &&
          cs.overflowX !== "visible" &&
          x1 < xBefore - 1
        ) {
          end = Math.min(end, x1);
        }
      } else if (containing) {
        escaped = "";
      }
      if (x1 - x0 <= 1 || y1 - y0 <= 1) return null;
      if (cs.position === "fixed") escaped = "fixed";
      else if (cs.position === "absolute") escaped = "absolute";
    }
    // What the ancestors leave of it must also be on the screen.
    return x0 < vw - 1 && x1 > 1 ? end : null;
  };
  // Every text node, inside open shadow roots too.
  const texts: Text[] = [];
  const collect = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n instanceof Text) texts.push(n);
      else if (n instanceof Element && n.shadowRoot) collect(n.shadowRoot);
    }
  };
  collect(document.body);
  try {
    for (const n of texts) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement ?? (n.parentNode instanceof ShadowRoot ? n.parentNode.host : null);
      if (!el) continue;
      // A slotted text node is laid out inside its slot, so its clips and
      // what hides it start there, not at its light-DOM host (review round 6).
      const start = n.assignedSlot ?? el;
      // A display: contents parent (Tailwind's `contents`, a slot showing its
      // fallback) has no box, and checkVisibility() is false on one, so the
      // nearest box is asked about display, opacity and content-visibility
      // (review round 5). visibility is inherited and can be set back to
      // visible below a hidden box, so it is read from the text's own parent
      // (review round 6).
      let shown: Element | null = start;
      while (shown && getComputedStyle(shown).display === "contents") shown = up(shown);
      if (!shown || getComputedStyle(start).visibility !== "visible") continue;
      if (!shown.checkVisibility({ opacityProperty: true })) continue;
      // Text the page marks inert is out of use: a carousel's peeking
      // next slide (a designed peek, not a cut), or a parked panel. inert
      // reaches into shadow trees, which closest() does not (finding 6).
      let inert = false;
      for (let a: Element | null = start; a && !inert; a = up(a)) inert = a.hasAttribute("inert");
      if (inert) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      // A line counts when some of it can be seen on the screen and it
      // straddles the right edge.
      const cuts = [...range.getClientRects()].some((r) => {
        const end = seen(start, r);
        return end !== null && end > vw + 1 && r.left < vw - 1;
      });
      if (cuts) cut.push(`<${el.tagName.toLowerCase()}> "${n.textContent.trim().slice(0, 60)}"`);
    }
  } finally {
    probe.host?.remove();
  }
  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: vw,
    cut,
  };
}

/** Measure the loaded page: `expect(cut).toEqual([])` and
 *  `expect(scrollWidth).toBeLessThanOrEqual(clientWidth)`. */
export function measure(page: EvaluatingPage): Promise<OverflowMeasure> {
  return page.evaluate(measureInPage);
}
