'use client';

import { useEffect, useState } from 'react';
import { Alert, Modal } from '@platform/ui-kit';
import { leaveExtras } from '../../lib/api/client';
import type { PolicySummaryRow } from '../../lib/h7/types';
import { emptyBlockCls, stateBlockCls } from '../../lib/ui';

/** The rules an employee needs before applying: notice, caps, documents, encashment, approval window. */
export default function PolicySummaryModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<PolicySummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    leaveExtras.policySummary().then((r) => setRows(r.data)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the policy.'));
  }, []);

  return (
    <Modal open onClose={onClose} title="Leave policy" maxWidth="max-w-2xl" closeOnBackdropClick>
      {error && <Alert tone="error">{error}</Alert>}
      {!rows && !error && <div className={stateBlockCls}>Loading…</div>}
      {rows && rows.length === 0 && <p className={emptyBlockCls}>No leave policy is configured yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((p) => (
            <li key={p.leave_type_name} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-on-surface">{p.leave_type_label}</h3>
                <span className={`rounded-full px-2 py-0.5 text-label-sm font-semibold ${p.is_paid ? 'bg-status-success-container text-on-status-success-container' : 'bg-surface-container text-on-surface-variant'}`}>
                  {p.is_paid ? 'Paid' : 'Unpaid'}
                </span>
              </div>
              <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-on-surface-variant sm:grid-cols-2">
                <li>{p.min_notice_days > 0 ? `Apply at least ${p.min_notice_days} day${p.min_notice_days === 1 ? '' : 's'} ahead` : 'No advance notice needed'}</li>
                <li>{p.max_consecutive_days ? `Up to ${p.max_consecutive_days} consecutive days` : 'No limit on consecutive days'}</li>
                <li>{p.allow_half_day ? 'Half days allowed' : 'Full days only'}</li>
                <li>{p.requires_document_after_days ? `Supporting document needed beyond ${p.requires_document_after_days} day${p.requires_document_after_days === 1 ? '' : 's'}` : 'No document needed'}</li>
                <li>{p.carry_forward ? 'Unused balance carries forward' : 'Unused balance does not carry forward'}</li>
                <li>{p.encashable ? `Can be encashed${p.max_encash_days ? ` (up to ${p.max_encash_days} days at a time)` : ''}` : 'Cannot be encashed'}</li>
                <li>Your approver is expected to respond within {p.sla_hours} hours</li>
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
