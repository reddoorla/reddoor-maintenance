/// <reference lib="dom" />
// Functions the a11y audit serializes into its generated Playwright spec with
// `Function.prototype.toString()`, exactly as it does classifyRouteResponse
// and revealBelowFold, so the tests exercise the code that ships rather than a
// transcription of it. Each must stay self-contained: no import, no
// module-scope identifier, and no named inner helper (a bundler's keep-names
// shim would reference a `__name` that does not exist where the text runs).
//
// Each answers one question for #100's reveal pass: is this the site's, or a
// cross-origin frame's? The pass brings lazy third-party iframes into load
// range — a Google Maps footer, a YouTube player, a booking widget — and what
// happens inside them is not the site's to fix. The rule for every one of
// them is the same, because the opposite mistake is the expensive one: a
// thing is the third party's ONLY on positive evidence that it happened inside
// a cross-origin frame. "I cannot tell" is the site's. And nothing moved out
// of the site's count is silent — it is recorded in the audit artifact and
// named in the summary.

/**
 * True when `url` is an http(s) document on another origin than `topOrigin`.
 * `about:blank`, `about:srcdoc`, `data:` and `blob:` documents — and anything
 * that does not parse — are NOT foreign: a srcdoc facade or a sandboxed
 * opaque-origin frame holds the site's own markup.
 */
export function isForeignUrl(url: string, topOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin !== topOrigin
  );
}

/**
 * The element one axe target selector names in the current document, stepping
 * into shadow roots: axe writes a node inside a shadow root as an array
 * (`["#host", "iframe"]`). Null when any step does not resolve.
 *
 * Runs IN THE PAGE (the spec hands it to `frame.evaluateHandle`).
 */
export function resolveTargetElement(selector: string | string[]): Element | null {
  const parts = Array.isArray(selector) ? selector : [selector];
  let root: Document | ShadowRoot | null = document;
  let element: Element | null = null;
  for (const part of parts) {
    if (root === null) return null;
    element = root.querySelector(part);
    if (element === null) return null;
    root = element.shadowRoot;
  }
  return element;
}

/** A violation as @axe-core/playwright returns it, reduced to what the filter reads. */
export type FrameFilterViolation = { id: string; nodes: Array<{ target: unknown }> };

/**
 * Split axe's violations into what counts against the site and what does not.
 *
 * A node whose `target` is nested (`[frame, …, frame, node]`) lives inside a
 * frame. `foreignFramePaths` holds the frame paths (`JSON.stringify` of
 * `target.slice(0, -1)`) on which the spec found positive evidence of a
 * cross-origin document — the frame's actual URL, followed through redirects,
 * shadow roots and same-origin wrapper frames. A node on one of those paths
 * is dropped; every other node is kept.
 *
 * `frame-focusable-content` is always kept. It is the site's own defect — an
 * `<iframe tabindex="-1">` whose document still has something to focus — but
 * axe can only evaluate it inside the frame, so its node is nested even though
 * the fix is in the site's markup.
 */
export function splitCrossOriginFrameNodes<V extends FrameFilterViolation>(
  violations: V[],
  foreignFramePaths: string[],
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
          foreignFramePaths.includes(JSON.stringify(node.target.slice(0, -1)))
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
 * Installed in EVERY frame before its own scripts run (the spec passes it to
 * `page.addInitScript`): a per-frame log of uncaught errors and unhandled
 * rejections, kept under a registered symbol so the site's code never sees
 * it. The spec reads each frame's log at the end of a route, and that log is
 * the positive evidence of which frame an error was thrown in.
 *
 * An entry is the error's message, or null when the browser hid it — an
 * error from a cross-origin script loaded without CORS reaches its window only
 * as "Script error.", with no error object. A null entry names no error, so it
 * can move nothing out of the site's count.
 */
export function recordFrameErrors(): void {
  const key = Symbol.for("reddoor.a11y.frameErrors");
  const store = window as unknown as Record<symbol, Array<string | null> | undefined>;
  if (store[key] !== undefined) return;
  const log: Array<string | null> = [];
  store[key] = log;
  window.addEventListener("error", (event) => {
    const error: unknown = event.error;
    if (error instanceof Error) log.push(error.message);
    else if (error === null || error === undefined) log.push(null);
    else log.push(String(error));
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    log.push(reason instanceof Error ? reason.message : String(reason));
  });
}

/** One frame's error log, as the spec reads it at the end of a route. */
export type FrameErrorLog = { url: string; foreign: boolean; messages: Array<string | null> };

/**
 * Split a route's uncaught errors (from Playwright's `pageerror`, which reports
 * errors from every frame, out-of-process ones included) into the site's and
 * a cross-origin frame's.
 *
 * An error moves to the third party's side ONLY when a cross-origin frame's
 * own log recorded an error with the same message — and only as many times as
 * that frame recorded it beyond what the site's frames (the top document,
 * same-origin, srcdoc and about:blank frames) recorded. Where the stack says
 * the error came from is never consulted: a site that calls a library it
 * loaded from another origin (Vimeo's player.js, Turnstile's api.js, Google
 * Maps) and crashes inside it has a stack that starts on that origin, and it is
 * still the site's crash.
 *
 * If a site frame logged a hidden error (null), nothing on the route moves:
 * that hidden error could be any of them, and "could be" is not evidence.
 */
export function splitThirdPartyErrors<E extends { message: string }>(
  errors: E[],
  frameLogs: FrameErrorLog[],
): { site: E[]; thirdParty: Array<E & { frame: string }> } {
  if (frameLogs.some((log) => !log.foreign && log.messages.some((m) => m === null))) {
    return { site: errors, thirdParty: [] };
  }
  const siteCounts = new Map<string, number>();
  const foreignFrames = new Map<string, string[]>();
  for (const log of frameLogs) {
    for (const message of log.messages) {
      if (message === null) continue;
      if (log.foreign) {
        const frames = foreignFrames.get(message) ?? [];
        frames.push(log.url);
        foreignFrames.set(message, frames);
      } else {
        siteCounts.set(message, (siteCounts.get(message) ?? 0) + 1);
      }
    }
  }
  const seen = new Map<string, number>();
  const site: E[] = [];
  const thirdParty: Array<E & { frame: string }> = [];
  for (const error of errors) {
    const nth = (seen.get(error.message) ?? 0) + 1;
    seen.set(error.message, nth);
    const frames = foreignFrames.get(error.message) ?? [];
    const frame = nth > (siteCounts.get(error.message) ?? 0) ? frames.shift() : undefined;
    if (frame === undefined) site.push(error);
    else thirdParty.push({ ...error, frame });
  }
  return { site, thirdParty };
}

/**
 * The first `at <url>` in an error's stack, or null when it names none.
 * Recorded on every error entry so the artifact says where the error came
 * from — for the reader only. It is NEVER used to decide whose error it is:
 * see splitThirdPartyErrors for why a stack that starts on another origin is
 * not evidence.
 */
export function firstStackUrl(stack: string): string | null {
  const match = /^\s*at .*?(https?:\/\/[^\s)]+)/m.exec(stack);
  return match !== null && match[1] !== undefined ? match[1] : null;
}
