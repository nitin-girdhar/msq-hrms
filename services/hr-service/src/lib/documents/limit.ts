import { sql } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { DOCUMENT_DEFAULT_BYTES } from '@hr/validation';

/** The upload limit for an org: what HR set (100 KB..3.5 MB), else the 3 MB default. Shared by every upload route. */
export async function documentLimitFor(orgId: string): Promise<number> {
  const rows = await withServiceTx(async (tx) =>
    (await tx.execute(sql`
      SELECT max_bytes FROM hr.document_settings WHERE org_id = ${orgId} AND NOT is_deleted`)) as unknown as Array<{ max_bytes: number }>);
  return rows[0]?.max_bytes ?? DOCUMENT_DEFAULT_BYTES;
}
