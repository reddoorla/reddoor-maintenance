import type { Db } from "./client.js";

/**
 * The cockpit snapshot's change counter (migration 0048): a number that moves on
 * every write to any table the snapshot reads, whoever writes. The cockpit keeps
 * the value its snapshot was read with and asks for this one row before reading
 * everything again; equal means nothing the snapshot shows has changed.
 *
 * Only equality means anything: the value is not a count of writes a caller can
 * rely on (a restore, or a failed statement's own trigger, may move it too). A
 * `db restore` sets it back to its dumped value, so a tab open across a restore
 * could in theory meet an equal value over different rows; reload after one.
 */
export async function readCockpitVersion(db: Db): Promise<number> {
  const row = await db
    .selectFrom("cockpit_version")
    .select("n")
    .where("id", "=", 1)
    .executeTakeFirst();
  if (!row) throw new Error("cockpit_version: the counter row is missing (migration 0048)");
  return Number(row.n);
}
