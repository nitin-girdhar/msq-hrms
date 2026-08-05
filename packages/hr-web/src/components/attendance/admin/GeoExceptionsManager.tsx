'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, PageSection } from '@platform/ui-kit';
import { geoExceptions as geoExceptionsApi } from '../../../lib/api/client';
import type { GeoExceptionType, GeoExceptionView } from '../../../lib/attendance/types';
import { formatDay } from '../../../lib/attendance/format';
import { emptyBlockCls, stateBlockCls } from '../../../lib/ui';
import GeoExceptionFormModal from './GeoExceptionFormModal';

const TYPE_LABEL: Record<GeoExceptionType, string> = {
  remote_role: 'Remote / field role',
  wfh: 'Work from home',
};

const TYPE_CHIP: Record<GeoExceptionType, string> = {
  remote_role: 'bg-indigo-50 text-indigo-700',
  wfh: 'bg-amber-50 text-amber-700',
};

interface Props {
  onNotice: (msg: string) => void;
}

export default function GeoExceptionsManager({ onNotice }: Props) {
  const [items, setItems] = useState<GeoExceptionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GeoExceptionView | undefined>(undefined);
  // Off by default so the tab opens on what is in force today; ended rows are
  // history and would otherwise crowd out the handful that still matter.
  const [includeInactive, setIncludeInactive] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    geoExceptionsApi
      .list({ include_inactive: includeInactive })
      .then((res) => setItems(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load geofence exceptions.'))
      .finally(() => setLoading(false));
  }, [includeInactive]);

  useEffect(() => { load(); }, [load]);

  // Ending an exception sets its end date to today rather than deleting it: the
  // punches already made under it must keep pointing at a row that explains them.
  const endToday = async (row: GeoExceptionView) => {
    setEndingId(row.id);
    try {
      await geoExceptionsApi.update(row.id, { effective_to: new Date().toISOString().slice(0, 10) });
      onNotice(`Exception for ${row.user_full_name} ends today.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end the exception.');
    } finally {
      setEndingId(null);
    }
  };

  return (
    <PageSection
      title="Geofence exceptions"
      action={
        <Button variant="primary" size="md" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
          Add exception
        </Button>
      }
    >
      <p className="mb-3 text-xs text-[#64748B]">
        People who may check in from outside the office radius — a rotating field role, or an approved
        work-from-home stretch. Their location is still captured on every punch; only the radius check is skipped.
      </p>

      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

      <label className="mb-3 flex items-center gap-2 text-xs text-[#475569]">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
          className="h-4 w-4 rounded border-[#CBD5E1]"
        />
        Include ended and switched-off exceptions
      </label>

      {loading ? (
        <div className={stateBlockCls}>Loading…</div>
      ) : items.length === 0 ? (
        <p className={emptyBlockCls}>
          {includeInactive
            ? 'No geofence exceptions yet.'
            : 'No exceptions are in force. Everyone is held to the office radius.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3 font-medium text-[#0F172A]">
                    {g.user_full_name}
                    {g.employee_code && <span className="ml-1.5 text-xs font-normal text-[#94A3B8]">{g.employee_code}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_CHIP[g.exception_type]}`}>
                      {TYPE_LABEL[g.exception_type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#475569]">{formatDay(g.effective_from)}</td>
                  <td className="px-4 py-3 text-[#475569]">{g.effective_to ? formatDay(g.effective_to) : 'Open-ended'}</td>
                  <td className="px-4 py-3 max-w-[240px] truncate text-[#475569]" title={g.reason}>{g.reason}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${g.is_in_force ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {g.is_in_force ? 'In force' : g.is_active ? 'Ended' : 'Switched off'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditing(g); setFormOpen(true); }}
                        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#0b6cbf] hover:bg-[#F8FAFC]"
                      >
                        Edit
                      </button>
                      {g.is_in_force && (
                        <button
                          type="button"
                          onClick={() => endToday(g)}
                          disabled={endingId === g.id}
                          title="Set the end date to today; past punches keep their reason"
                          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60"
                        >
                          {endingId === g.id ? 'Ending…' : 'End now'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GeoExceptionFormModal
        open={formOpen}
        exception={editing}
        onClose={() => { setFormOpen(false); setEditing(undefined); }}
        onSaved={(msg) => { onNotice(msg); load(); }}
      />
    </PageSection>
  );
}
