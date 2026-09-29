/// <reference lib="dom" />
// Functions the a11y audit serializes into its generated Playwright spec
// with `Function.prototype.toString()`, exactly as it does classifyRouteResponse
// and revealBelowFold, so the tests exercise the code that ships rather than a
// transcription of it. Each must stay self-contained: no import, no
// module-scope identifier, and no named inner helper (a bundler's keep-names
// shim would reference a `__name` that does not exist where the text runs).
//
// Each answers one question for #100's reveal pass: is this the site's,
// or another origin's? The pass brings lazy third-party iframes into load
// range — a Google Maps footer, a YouTube player, a booking widget — and what
// happens inside them is not the site's to fix. None of them may turn
// "not the site's" into "silently gone": each one's output is recorded in the
// audit artifact and named in the summary.

/** A violation as @axe-core/playwright returns it, reduced to what the filter reads. */
export type FrameFilterViolation = { id: string; nodes: Array<{ target: unknown }> };

/**
 * Split axe's violations into what counts against the site and what does not.
 *
 * A node whose `target` is nested (`[frameSelector, innerSelector, …]`) lives
 * inside a frame. When that frame — `target[0]`, the outermost one — is
 * cross-origin to the page, the node is a third party's markup and is dropped.
 * Everything else is kept: nodes in the top document, nodes in same-origin
 * frames, and a `target[0]` that is not a plain selector string (shadow DOM),
 * which cannot be resolved here and so stays the site's.
 *
 * `frame-focusable-content` is always kept. It is the site's own defect — an
 * `<iframe tabindex="-1">` whose document still has something to focus — but
 * axe can only evaluate it inside the frame, so its node is nested even though
 * the fix is in the site's markup. Dropping it is exactly what the legacy-mode
 * attempt did for every cross-origin iframe, which review caught.
 */
export function splitCrossOriginFrameNodes<V extends FrameFilterViolation>(
  violations: V[],
  crossOriginFrames: string[],
): { kept: V[]; dropped: number; rules: string[] } {
  const kept: V[] = [];
  const rules: string[] = [];
  let dropped = 0;
  for (const violation of violations) {
    if (violation.id === "frame-focusable-content") {
      kept.push(violation);
      continue;
    }
    const nodes = violation.nodes.filter(
      (node) =>
        !(
          Array.isArray(node.target) &&
          node.target.length > 1 &&
          typeof node.target[0] === "string" &&
          crossOriginFrames.includes(node.target[0])
        ),
    );
    const lost = violation.nodes.length - nodes.length;
    if (lost > 0) {
      dropped += lost;
      if (!rules.includes(violation.id)) rules.push(violation.id);
    }
    if (nodes.length > 0) kept.push({ ...violation, nodes });
  }
  return { kept, dropped, rules };
}

/**
 * Of the given top-document selectors, the ones naming an `<iframe>` or
 * `<frame>` whose `src` is an http(s) URL on another origin than the page.
 *
 * Runs IN THE PAGE (the spec hands it to `page.evaluate`). A frame with no
 * `src`, an `about:`, `data:`, `blob:` or `srcdoc` document, or a selector
 * that no longer resolves is NOT cross-origin here — those stay the site's,
 * because the question the caller asks is "may I drop this?", and the safe
 * answer to "I cannot tell" is no.
 */
export function crossOriginFrameSelectors(selectors: string[]): string[] {
  return selectors.filter((selector) => {
    const element = document.querySelector(selector);
    if (element === null || (element.tagName !== "IFRAME" && element.tagName !== "FRAME")) {
      return false;
    }
    const src = element.getAttribute("src");
    if (src === null || src.trim() === "") return false;
    let url: URL;
    try {
      url = new URL(src, location.href);
    } catch {
      return false;
    }
    return (
      (url.protocol === "http:" || url.protocol === "https:") && url.origin !== location.origin
    );
  });
}
