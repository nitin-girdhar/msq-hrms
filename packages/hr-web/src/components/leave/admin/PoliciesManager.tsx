'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { leave as leaveApi } from '../../../lib/api/client';
import type { LeavePolicyView } from '../../../lib/leave/types';
import PolicyFormModal from './PolicyFormModal';

interface Props {
  actor: SessionUser;
  onNotice: (msg: string) => void;
}

export default function PoliciesManager({ actor, onNotice }: Props) {
  const [policies, setPolicies] = useState<LeavePolicyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    leaveApi
      .policies()
      .then((res) => setPolicies(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load policies.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-on-surface-variant">Effective-dated leave rules per type. A revision adds a new row from a future date.</p>
        <button type="button" onClick={() => setFormOpen(true)} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90">
          Create / revise policy
        </button>
      </div>

      {error && <div className="rounded-lg border border-status-overdue/30 bg-status-overdue-container px-4 py-2 text-xs text-on-status-overdue-container">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-outline">Loading…</div>
      ) : policies.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest px-4 py-8 text-center text-sm text-outline">No policies yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Accrual</th>
                <th className="px-4 py-3">Half-day</th>
                <th className="px-4 py-3">Levels</th>
                <th className="px-4 py-3">Effective from</th>
                <th className="px-4 py-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
                  <td className="px-4 py-3 font-medium text-on-surface">{p.leave_type_label}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.org_id ? 'bg-primary-fixed text-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                      {p.org_id ? 'Org' : 'Tenant-wide'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {p.accrual_frequency === 'none' ? '—' : `${p.accrual_amount}/${p.accrual_frequency}`}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{p.allow_half_day ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{p.approval_levels}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{p.applicable_from}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.is_active ? 'bg-status-success-container text-on-status-success-container' : 'bg-surface-container text-on-surface-variant'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PolicyFormModal
        open={formOpen}
        actor={actor}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => { onNotice(msg); load(); }}
      />
    </div>
  );
}
