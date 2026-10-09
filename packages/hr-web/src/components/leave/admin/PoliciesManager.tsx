'use client';

import { useCallback, useEffect, useState } from 'react';
import { can, CAPABILITY } from '@platform/rbac';
import { InfoTip } from '@platform/ui-kit';
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

  // Derived from the rows already loaded — no second request, and the numbers
  // cannot disagree with the table under them.
  const activeCount = policies.filter((p) => p.is_active).length;
  const tenantWide = policies.filter((p) => !p.org_id).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-sm text-on-surface-variant">
          Leave rules per type
          <InfoTip label="About leave policies">Effective-dated leave rules per type. A revision adds a new row from a future date.</InfoTip>
        </p>
        {can(actor, CAPABILITY.HR_LEAVE_ADMIN_POLICIES_MANAGE) && <button type="button" onClick={() => setFormOpen(true)} className="min-h-11 shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90">
          Create / revise policy
        </button>}
      </div>

      {!loading && !error && policies.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { label: 'Policies', value: policies.length },
            { label: 'Active', value: activeCount },
            { label: 'Tenant-wide', value: tenantWide },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 shadow-sm">
              <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">{s.label}</p>
              <p className="mt-0.5 text-headline-sm font-semibold tabular-nums text-on-surface">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {error && <div className="rounded-lg border border-status-overdue/30 bg-status-overdue-container px-4 py-2 text-xs text-on-status-overdue-container">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-outline">Loading…</div>
      ) : policies.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest px-4 py-8 text-center text-sm text-outline">No policies yet.</p>
      ) : (
        <>
        {/* Phones get one card per policy: the table needs 860px, so on a 390px
            screen it was a sideways-scrolling strip with the Active chip — the
            column people actually scan for — parked off-screen. */}
        <ul className="flex flex-col gap-2 lg:hidden">
          {policies.map((p) => (
            <li key={p.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-on-surface">{p.leave_type_label}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${p.is_active ? 'bg-status-success-container text-on-status-success-container' : 'bg-surface-container text-on-surface-variant'}`}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${p.org_id ? 'bg-primary-fixed text-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                  {p.org_id ? 'Org' : 'Tenant-wide'}
                </span>
                <span className="rounded-full bg-surface-container px-2 py-0.5 text-[0.6875rem] text-on-surface-variant">
                  {p.accrual_frequency === 'none' ? 'No accrual' : `${p.accrual_amount}/${p.accrual_frequency}`}
                </span>
                {p.allow_half_day && (
                  <span className="rounded-full bg-surface-container px-2 py-0.5 text-[0.6875rem] text-on-surface-variant">Half-day</span>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                <div className="flex gap-1"><dt>Levels:</dt><dd className="font-medium text-on-surface">{p.approval_levels}</dd></div>
                <div className="flex gap-1"><dt>From:</dt><dd className="font-medium text-on-surface">{p.applicable_from}</dd></div>
              </dl>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm lg:block">
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
                    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${p.org_id ? 'bg-primary-fixed text-primary' : 'bg-surface-container text-on-surface-variant'}`}>
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
                    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${p.is_active ? 'bg-status-success-container text-on-status-success-container' : 'bg-surface-container text-on-surface-variant'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
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
