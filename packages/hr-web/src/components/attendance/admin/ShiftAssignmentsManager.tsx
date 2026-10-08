'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, Button, PageSection } from '@platform/ui-kit';
import { shiftAssignments as shiftAssignmentsApi } from '../../../lib/api/client';
import type { ShiftAssignmentView } from '../../../lib/attendance/types';
import { formatDay } from '../../../lib/attendance/format';
import { emptyBlockCls, stateBlockCls } from '../../../lib/ui';
import ShiftAssignmentFormModal from './ShiftAssignmentFormModal';
import RecomputeAttendanceModal from './RecomputeAttendanceModal';

interface Props {
  actor: SessionUser;
  onNotice: (msg: string) => void;
}

export default function ShiftAssignmentsManager({ actor, onNotice }: Props) {
  const canManage = can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN_ASSIGNMENTS_MANAGE);
  const [items, setItems] = useState<ShiftAssignmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  // The row being edited; undefined while the modal is in "create" mode.
  const [editing, setEditing] = useState<ShiftAssignmentView | undefined>(undefined);
  const [recomputing, setRecomputing] = useState<ShiftAssignmentView | undefined>(undefined);
  const [recomputeOpen, setRecomputeOpen] = useState(false);

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
    <PageSection
      title="Shift assignments"
      action={
        canManage ? (
          <Button variant="primary" size="md" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
            Assign shift
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 text-xs text-on-surface-variant">Effective-dated shift assignments per employee.</p>

      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

      {loading ? (
        <div className={stateBlockCls}>Loading…</div>
      ) : items.length === 0 ? (
        <p className={emptyBlockCls}>No shift assignments yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
                  <td className="px-4 py-3 font-medium text-on-surface">{a.user_full_name}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{a.shift_name}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{formatDay(a.effective_from)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{a.effective_to ? formatDay(a.effective_to) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${a.is_active ? 'bg-status-success-container text-on-status-success-container' : 'bg-surface-container text-on-surface-variant'}`}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canManage && <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditing(a); setFormOpen(true); }}
                        className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-container-low"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRecomputing(a); setRecomputeOpen(true); }}
                        title="Re-apply shift rules to days already marked"
                        className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low"
                      >
                        Recompute
                      </button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ShiftAssignmentFormModal
        open={formOpen}
        assignment={editing}
        onClose={() => { setFormOpen(false); setEditing(undefined); }}
        onSaved={(msg) => { onNotice(msg); load(); }}
      />

      <RecomputeAttendanceModal
        open={recomputeOpen}
        assignment={recomputing}
        onClose={() => { setRecomputeOpen(false); setRecomputing(undefined); }}
        onSaved={(msg) => onNotice(msg)}
      />
    </PageSection>
  );
}
