export function boxCommand(
  box: { hide: string[]; writable: string[] },
  cmd: string,
  args: string[],
): [string, string[]];
export function mountPoints(text: string): string[];
