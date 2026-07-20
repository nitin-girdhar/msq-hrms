'use client';

import { useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { leave as leaveApi } from '../../../lib/api/client';
import { MONTHS, canManageTenantLeave } from '../../../lib/leave/format';

interface Props {
  actor: SessionUser;
  onNotice: (msg: string) => void;
}

function monthLabel(m: number): string {
  const end = m === 1 ? 12 : m - 1;
  const base = `${MONTHS[m - 1]}–${MONTHS[end - 1]}`;
  return m === 4 ? `${base} (India FY)` : base;
}

export default function LeaveCycleSetting({ actor, onNotice }: Props) {
  const [month, setMonth] = useState(4);
  const [scope, setScope] = useState<'org' | 'tenant'>('org');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    leaveApi
      .getSettings()
      .then((res) => setMonth(res.data.leave_cycle_start_month))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await leaveApi.updateSettings({ leave_cycle_start_month: month, scope });
      onNotice(`Leave cycle set to ${monthLabel(month)}${scope === 'tenant' ? ' (tenant-wide)' : ''}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20';

  if (loading) return <div className="py-8 text-center text-sm text-[#94A3B8]">Loading…</div>;

  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-[#64748B]">
        The leave cycle determines accrual periods and year-end carry-forward. It is not the calendar year.
      </p>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="lc-month" className="text-xs font-semibold text-[#0F172A]">Cycle start month</label>
        <select id="lc-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={saving} className={inputCls}>
          {MONTHS.map((_, i) => (
            <option key={i + 1} value={i + 1}>{monthLabel(i + 1)}</option>
          ))}
        </select>
      </div>

      {canManageTenantLeave(actor.rank) && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lc-scope" className="text-xs font-semibold text-[#0F172A]">Scope</label>
          <select id="lc-scope" value={scope} onChange={(e) => setScope(e.target.value as 'org' | 'tenant')} disabled={saving} className={inputCls}>
            <option value="org">This org</option>
            <option value="tenant">Tenant-wide default</option>
          </select>
        </div>
      )}

      <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60">
        {saving ? 'Saving…' : 'Save cycle'}
      </button>
    </div>
  );
}
