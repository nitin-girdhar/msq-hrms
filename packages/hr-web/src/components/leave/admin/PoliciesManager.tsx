'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@crm/types';
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
        <p className="text-sm text-[#64748B]">Effective-dated leave rules per type. A revision adds a new row from a future date.</p>
        <button type="button" onClick={() => setFormOpen(true)} className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699]">
          Create / revise policy
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>
      ) : policies.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">No policies yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
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
                <tr key={p.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3 font-medium text-[#0F172A]">{p.leave_type_label}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.org_id ? 'bg-blue-50 text-[#0b6cbf]' : 'bg-slate-100 text-slate-600'}`}>
                      {p.org_id ? 'Org' : 'Tenant-wide'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#475569]">
                    {p.accrual_frequency === 'none' ? '—' : `${p.accrual_amount}/${p.accrual_frequency}`}
                  </td>
                  <td className="px-4 py-3 text-[#475569]">{p.allow_half_day ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-[#475569]">{p.approval_levels}</td>
                  <td className="px-4 py-3 text-[#475569]">{p.applicable_from}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
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
