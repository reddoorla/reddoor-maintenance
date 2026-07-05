/**
 * Load-aware page readiness for splash screens and intro overlays.
 *
 * Every splash in the fleet today hides the page behind a blind `setTimeout`,
 * which punishes fast loads (a fully-painted page sits under an opaque cover
 * for the full timer) and can still under-shoot slow ones. `whenPageReady`
 * replaces the timer with real signals — eager-image settlement, document
 * load, caller-supplied promises — bracketed by a floor (`minMs`, so a brand
 * moment never flashes) and a ceiling (`maxMs`, so a stalled resource can
 * never wedge the splash open).
 *
 * Framework-free and SSR-safe: with no DOM present it resolves immediately
 * with reason "no-dom", so it can be called unguarded from universal code.
 * The `env` parameter exists for tests (vitest runs in a node environment);
 * production callers omit it and the globals are used.
 *
 * Local structural types stand in for DOM lib types because this package
 * compiles with `lib: ["ES2022"]` and no DOM — same approach as
 * src/configs/svelte.ts, which declares minimal shapes to avoid a peer dep.
 */

type ListenerTarget = {
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
};

type ImageLike = ListenerTarget & {
  /** True once the load attempt is terminal — fires for both success AND error. */
  complete: boolean;
};

type DocumentLike = ListenerTarget & {
  readyState: string;
  querySelectorAll(selector: string): ArrayLike<ImageLike>;
};

type WindowLike = ListenerTarget & {
  matchMedia?(query: string): { matches: boolean };
};

export type PageReadyEnv = {
  document?: DocumentLike | undefined;
  window?: WindowLike | undefined;
};

export type PageReadyOptions = {
  /** Never resolve before this many ms — keeps a splash from flashing. Default 400. */
  minMs?: number;
  /** Always resolve by this many ms, loaded or not. Default 2500. */
  maxMs?: number;
  /**
   * Selector for images that must settle (load OR error) before the page
   * counts as ready. Defaults to `img[loading="eager"]` — above-the-fold
   * imagery. Pass `false` to skip image tracking.
   */
  waitForImages?: string | false;
  /**
   * Also wait for `document.readyState === "complete"` (the window `load`
   * event). Default false: full load includes every iframe and third-party
   * script, which routinely lags the meaningful first paint by seconds —
   * eager images are usually the right signal for a splash.
   */
  waitForDocument?: boolean;
  /** Extra readiness signals (e.g. a video poster decode). Rejections count as settled. */
  signals?: ReadonlyArray<Promise<unknown>>;
};

export type PageReadyReason = "ready" | "timeout" | "no-dom";

const DEFAULT_MIN_MS = 400;
const DEFAULT_MAX_MS = 2500;
const DEFAULT_IMAGE_SELECTOR = 'img[loading="eager"]';

function globals(): PageReadyEnv {
  return globalThis as unknown as PageReadyEnv;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function documentComplete(doc: DocumentLike, win: WindowLike): Promise<void> {
  if (doc.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => win.addEventListener("load", () => resolve(), { once: true }));
}

function imageSettled(img: ImageLike): Promise<void> {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
  });
}

/**
 * Resolve when the page is visually ready — or at `maxMs`, whichever comes
 * first — but never before `minMs`. The returned reason says which path won.
 *
 * @example Reveal a splash overlay when the hero has painted:
 * ```ts
 * onMount(() => {
 *   whenPageReady({ minMs: 600, maxMs: 2400 }).then(() => (isReady = true));
 * });
 * ```
 */
export function whenPageReady(
  options: PageReadyOptions = {},
  env: PageReadyEnv = {},
): Promise<PageReadyReason> {
  const doc = env.document ?? globals().document;
  const win = env.window ?? globals().window;
  if (!doc || !win) return Promise.resolve("no-dom");

  const minMs = options.minMs ?? DEFAULT_MIN_MS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const selector = options.waitForImages ?? DEFAULT_IMAGE_SELECTOR;

  const waits: Promise<unknown>[] = [];
  if (options.waitForDocument) waits.push(documentComplete(doc, win));
  if (selector !== false) {
    for (const img of Array.from(doc.querySelectorAll(selector))) waits.push(imageSettled(img));
  }
  for (const signal of options.signals ?? []) waits.push(signal.catch(() => undefined));

  const ready = Promise.all(waits).then<PageReadyReason>(() => "ready");
  const capped =
    maxMs === Infinity
      ? ready
      : Promise.race([ready, delay(maxMs).then<PageReadyReason>(() => "timeout")]);

  return Promise.all([capped, delay(minMs)]).then(([reason]) => reason);
}

/**
 * True when the user has asked the OS for reduced motion. Splash callers
 * should collapse `minMs` to 0 and skip decorative fades when this is set.
 * False when no DOM (SSR) or `matchMedia` is unavailable.
 */
export function prefersReducedMotion(env: PageReadyEnv = {}): boolean {
  const win = env.window ?? globals().window;
  return win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
