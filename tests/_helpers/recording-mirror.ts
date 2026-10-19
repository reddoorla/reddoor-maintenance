/** A Turso mirror stub that records each `(siteId, fields)` write in `calls` and succeeds. */
export function recordingMirror(): {
  mirror: (siteId: string, fields: Record<string, unknown>) => Promise<boolean>;
  calls: Array<{ siteId: string; fields: Record<string, unknown> }>;
} {
  const calls: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
  const mirror = async (siteId: string, fields: Record<string, unknown>) => {
    calls.push({ siteId, fields });
    return true;
  };
  return { mirror, calls };
}
