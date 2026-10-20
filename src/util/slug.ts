/** Filesystem-safe, never empty. Collapses anything outside [a-z0-9.-] to a
 *  single dash so a hostname becomes a sane filename fragment. Unlike the
 *  `video` command's `slugify`, it keeps dots and falls back to "prospect". */
export function filenameSlug(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "prospect";
}
