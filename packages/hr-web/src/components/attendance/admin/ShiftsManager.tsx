'use client';

import { useCallback, useEffect, useState } from 'react';
import { shifts as shiftsApi } from '../../../lib/api/client';
import type { ShiftView } from '../../../lib/attendance/types';
import ShiftFormModal from './ShiftFormModal';

interface Props {
  onNotice: (msg: string) => void;
}

export default function ShiftsManager({ onNotice }: Props) {
  const [items, setItems] = useState<ShiftView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftView | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    shiftsApi
      .list()
      .then((res) => setItems(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load shifts.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#64748B]">Org shift definitions used for late/early-exit and half/full-day thresholds.</p>
        <button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699]">
          Create shift
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">No shifts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Timing</th>
                <th className="px-4 py-3">Grace</th>
                <th className="px-4 py-3">Half / Full day</th>
                <th className="px-4 py-3">Night</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3 font-medium text-[#0F172A]">{s.name}</td>
                  <td className="px-4 py-3 text-[#475569]">{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</td>
                  <td className="px-4 py-3 text-[#475569]">{s.grace_minutes}m</td>
                  <td className="px-4 py-3 text-[#475569]">{s.min_half_day_minutes}m / {s.min_full_day_minutes}m</td>
                  <td className="px-4 py-3 text-[#475569]">{s.is_night_shift ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => { setEditing(s); setFormOpen(true); }} className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ShiftFormModal
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => { onNotice(msg); load(); }}
      />
    </div>
  );
}
