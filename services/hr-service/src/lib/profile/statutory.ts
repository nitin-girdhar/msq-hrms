// Statutory / bank detail helpers. Pure. The values are stored as plain text for now, so
// what keeps them private is WHO may read them; masking is how the rest of the product
// shows "on file" without showing the value.

export interface StatutoryRow {
  pan: string | null;
  aadhaar: string | null;
  uan: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  account_number: string | null;
  ifsc: string | null;
  account_type: string | null;
  tax_regime: string | null;
}

/** Hide all but the last `keep` characters. Short values are hidden entirely. */
export function maskTail(value: string | null | undefined, keep = 4): string | null {
  if (!value) return null;
  if (value.length <= keep) return '•'.repeat(value.length);
  return '•'.repeat(value.length - keep) + value.slice(-keep);
}

/** The view of a statutory row that is safe to show to someone who may open the profile but not the numbers. */
export function maskStatutory(row: StatutoryRow | null): StatutoryRow | null {
  if (!row) return null;
  return {
    ...row,
    pan: maskTail(row.pan),
    aadhaar: maskTail(row.aadhaar),
    uan: maskTail(row.uan),
    account_number: maskTail(row.account_number),
    // Bank name, branch, IFSC (a public branch code), account type and tax regime are not secrets.
  };
}

/** A partial update: absent = leave, '' = clear, otherwise replace. */
export type StatutoryPatch = Partial<Record<keyof StatutoryRow, string | undefined>>;

export const EMPTY_STATUTORY: StatutoryRow = {
  pan: null, aadhaar: null, uan: null, bank_name: null, bank_branch: null,
  account_number: null, ifsc: null, account_type: null, tax_regime: null,
};

/**
 * Apply a partial payload over an existing row. A key that is absent is left alone;
 * '' clears it to null; anything else replaces it.
 */
export function mergeStatutory(
  current: StatutoryRow | null,
  patch: StatutoryPatch,
): StatutoryRow {
  const out: StatutoryRow = { ...(current ?? EMPTY_STATUTORY) };
  for (const key of Object.keys(out) as Array<keyof StatutoryRow>) {
    const v = patch[key];
    if (v === undefined) continue;
    out[key] = v === '' ? null : v;
  }
  return out;
}

/** Names of the fields a patch touches — what the audit log records instead of the values. */
export function changedFields(patch: StatutoryPatch): string[] {
  return (Object.keys(patch) as Array<keyof StatutoryRow>).filter((k) => patch[k] !== undefined);
}
