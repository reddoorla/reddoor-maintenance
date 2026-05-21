const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/g;
const SIMPLE_ON_EVENT = /\bon:([a-z]+)(?=\s*=)/g;

export function onEventToHandler(source: string): string {
  const masked: string[] = [];
  const placeholder = (i: number): string => ` SCRIPT_${i} `;
  const intermediate = source.replace(SCRIPT_BLOCK, (match) => {
    masked.push(match);
    return placeholder(masked.length - 1);
  });

  const rewritten = intermediate.replace(SIMPLE_ON_EVENT, (_full, name: string) => `on${name}`);

  let out = rewritten;
  masked.forEach((blk, i) => {
    out = out.replace(placeholder(i), blk);
  });

  return out;
}
