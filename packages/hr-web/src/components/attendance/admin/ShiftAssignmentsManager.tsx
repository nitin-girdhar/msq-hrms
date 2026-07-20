'use client';

import { useCallback, useEffect, useState } from 'react';
import { shiftAssignments as shiftAssignmentsApi } from '../../../lib/api/client';
import type { ShiftAssignmentView } from '../../../lib/attendance/types';
import { formatDay } from '../../../lib/attendance/format';
import ShiftAssignmentFormModal from './ShiftAssignmentFormModal';

interface Props {
  onNotice: (msg: string) => void;
}

export default function ShiftAssignmentsManager({ onNotice }: Props) {
  const [items, setItems] = useState<ShiftAssignmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    shiftAssignmentsApi
      .list()
      .then((res) => setItems(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load shift assignments.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#64748B]">Effective-dated shift assignments per employee.</p>
        <button type="button" onClick={() => setFormOpen(true)} className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699]">
          Assign shift
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">No shift assignments yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3 font-medium text-[#0F172A]">{a.user_full_name}</td>
                  <td className="px-4 py-3 text-[#475569]">{a.shift_name}</td>
                  <td className="px-4 py-3 text-[#475569]">{formatDay(a.effective_from)}</td>
                  <td className="px-4 py-3 text-[#475569]">{a.effective_to ? formatDay(a.effective_to) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${a.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ShiftAssignmentFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => { onNotice(msg); load(); }}
      />
    </div>
  );
}
