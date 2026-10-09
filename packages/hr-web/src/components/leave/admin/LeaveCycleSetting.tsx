'use client';

import { useEffect, useState } from 'react';
import { can, CAPABILITY } from '@platform/rbac';
import { InfoTip } from '@platform/ui-kit';
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
    'rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

  if (loading) return <div className="py-8 text-center text-sm text-outline">Loading…</div>;

  return (
    <div className="max-w-md space-y-4">
      <p className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        Leave cycle
        <InfoTip label="About the leave cycle">The leave cycle determines accrual periods and year-end carry-forward. It is not the calendar year.</InfoTip>
      </p>
      {error && <div className="rounded-lg border border-status-overdue/30 bg-status-overdue-container px-4 py-2 text-xs text-on-status-overdue-container">{error}</div>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="lc-month" className="text-xs font-semibold text-on-surface">Cycle start month</label>
        <select id="lc-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={saving} className={inputCls}>
          {MONTHS.map((_, i) => (
            <option key={i + 1} value={i + 1}>{monthLabel(i + 1)}</option>
          ))}
        </select>
      </div>

      {canManageTenantLeave(actor) && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lc-scope" className="text-xs font-semibold text-on-surface">Scope</label>
          <select id="lc-scope" value={scope} onChange={(e) => setScope(e.target.value as 'org' | 'tenant')} disabled={saving} className={inputCls}>
            <option value="org">Specific branch</option>
            <option value="tenant">{`All ${actor.tenant_name} Branches`}</option>
          </select>
        </div>
      )}

      {can(actor, CAPABILITY.HR_LEAVE_ADMIN_CYCLE_MANAGE) && <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60">
        {saving ? 'Saving…' : 'Save cycle'}
      </button>}
    </div>
  );
}
