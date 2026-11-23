/** A filled text field, trimmed; else the code's wording. */
export function text(value: string | null | undefined, fallback: string): string {
  return value && value.trim() ? value.trim() : fallback;
}
