export function removeDollarRestProps(source: string): string {
  let next = source;
  next = next.replace(/\$\$restProps/g, "rest");
  next = next.replace(/^\s*interface\s+\$\$Props\s*\{[^}]*\}\s*\n/gm, "");
  return next;
}
