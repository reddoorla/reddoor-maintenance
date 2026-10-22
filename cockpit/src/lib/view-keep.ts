/**
 * The operator's place on a page, kept across a remount for a fresh snapshot
 * (lib/freshness.ts). The layout remounts a page when the store's counter moves,
 * so that no control keeps state built from the old data; that must not also
 * close the lead the operator has open, drop the chip filter they picked, or
 * jump them back to the top. A navigation to another page keeps nothing, as
 * when every link was a full page load.
 *
 * A `<details>` is matched by what already names it, so the pages' markup stays
 * as the old pages wrote it (the parity tests): its class (the lanes on `/` and
 * `/fleet`), else the submission its row's buttons act on (`data-id`). A
 * component's own state is matched by the name it registers with `keepValue`.
 */

export type KeptView = {
  page: string;
  open: Map<string, boolean>;
  values: Map<string, unknown>;
  scrollY: number;
};

/** The name a `<details>` is kept under, or null when nothing names it. */
export function detailsKey(el: HTMLDetailsElement): string | null {
  if (el.className !== "") return `class:${el.className}`;
  const id = el.parentElement?.querySelector("[data-id]")?.getAttribute("data-id");
  return id ? `id:${id}` : null;
}

function eachDetails(root: ParentNode, f: (key: string, el: HTMLDetailsElement) => void): void {
  for (const el of root.querySelectorAll("details")) {
    const key = detailsKey(el);
    if (key !== null) f(key, el);
  }
}

const live = new Map<string, () => unknown>();
let restoring: KeptView | null = null;

/** Register a value to carry over a remount (call during component init; the
 *  returned function unregisters it, for `onDestroy`). */
export function keepValue(name: string, read: () => unknown): () => void {
  live.set(name, read);
  return () => {
    if (live.get(name) === read) live.delete(name);
  };
}

/** The value a remounting component starts from: what it held before the
 *  remount, else `initial`. */
export function keptValue<T>(name: string, initial: T): T {
  return restoring?.values.has(name) ? (restoring.values.get(name) as T) : initial;
}

/** Record the page as it is now, before it remounts. */
export function captureView(page: string, root: ParentNode, scrollY: number): KeptView {
  const open = new Map<string, boolean>();
  eachDetails(root, (key, el) => open.set(key, el.open));
  const values = new Map<string, unknown>();
  for (const [name, read] of live) values.set(name, read());
  return { page, open, values, scrollY };
}

/** Start a remount of `page`: what was captured on the same page carries over. */
export function beginRestore(kept: KeptView | null, page: string): void {
  restoring = kept !== null && kept.page === page ? kept : null;
}

/** The remount is in the DOM: reopen what was open and put the scroll back. */
export function finishRestore(root: ParentNode, scrollTo: (y: number) => void): void {
  const kept = restoring;
  restoring = null;
  if (kept === null) return;
  eachDetails(root, (key, el) => {
    const was = kept.open.get(key);
    if (was !== undefined) el.open = was;
  });
  scrollTo(kept.scrollY);
}
