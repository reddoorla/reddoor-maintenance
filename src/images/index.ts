/**
 * Prismic image helpers for fleet sites.
 *
 * Dependency-free on purpose: consuming sites import this subpath directly, so
 * it must never reach a central-only devDep. The image field is accepted
 * structurally rather than as `@prismicio/client`'s `ImageField`, which keeps
 * `@prismicio/client` out of this package's dependency graph while still
 * type-checking at the call site — a real `ImageField` satisfies the shape.
 */

/**
 * The srcset widths `<PrismicImage>` emits when no `widths` prop is given.
 * Mirrors `DEFAULT_WIDTHS` in `@prismicio/client`'s `asImageWidthSrcSet()`.
 */
export const PRISMIC_DEFAULT_WIDTHS = [640, 828, 1200, 2048, 3840] as const;

/** The structural shape `cappedWidths()` needs from a Prismic image field. */
export type ImageFieldLike = {
  dimensions?: { width?: number | null } | null;
} | null;

/**
 * Build a srcset width list that never exceeds the image's own pixel width.
 *
 * Prismic advertises every default width regardless of how big the source asset
 * actually is. Because fleet sites also set `sizes` (or fall back to the `100vw`
 * default), browsers on wide or retina screens genuinely pick those top
 * candidates — so a 558px photo gets upscaled ~7x on demand, and a 40px logo by
 * 96x. Those variants are always a cache MISS, are expensive for Prismic to
 * generate, and are the ones that surface as slow or failed images in production
 * while the same asset's smaller variants serve fine.
 *
 * Capping at the native width keeps the rendered result identical — upscaling
 * adds no detail — while removing the expensive transforms entirely.
 *
 * Sources already at or above the widest candidate keep the default list
 * untouched: appending their native width there would *add* a candidate wider
 * than any previously offered, making large images heavier rather than lighter.
 *
 * @example
 * ```svelte
 * <PrismicImage
 *   field={slice.primary.image}
 *   widths={cappedWidths(slice.primary.image)}
 *   sizes="(min-width: 768px) 50vw, 100vw"
 * />
 * ```
 *
 * @param field - The Prismic image field being rendered. An empty or
 *   dimensionless field falls back to the candidate list unchanged.
 * @param widths - Candidate widths to filter. Defaults to Prismic's own list.
 * @returns Widths no larger than the source, ascending.
 */
export function cappedWidths(
  field: ImageFieldLike | undefined,
  widths: readonly number[] = PRISMIC_DEFAULT_WIDTHS,
): number[] {
  const candidates = [...widths];
  const native = field?.dimensions?.width;

  if (typeof native !== "number" || !Number.isFinite(native) || native <= 0) {
    return candidates;
  }
  if (native >= Math.max(...candidates)) return candidates;

  return [...candidates.filter((w) => w < native), native];
}
