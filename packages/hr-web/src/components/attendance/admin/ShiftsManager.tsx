'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, PageSection } from '@platform/ui-kit';
import { shifts as shiftsApi } from '../../../lib/api/client';
import type { ShiftView } from '../../../lib/attendance/types';
import { emptyBlockCls, stateBlockCls } from '../../../lib/ui';
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
    <PageSection
      title="Shifts"
      action={
        <Button variant="primary" size="md" onClick={() => { setEditing(null); setFormOpen(true); }}>
          Create shift
        </Button>
      }
    >
      <p className="mb-3 text-xs text-on-surface-variant">
        Org shift definitions used for late/early-exit and half/full-day thresholds.
      </p>

      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

      {loading ? (
        <div className={stateBlockCls}>Loading…</div>
      ) : items.length === 0 ? (
        <p className={emptyBlockCls}>No shifts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
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
                <tr key={s.id} className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-low">
                  <td className="px-4 py-3 font-medium text-on-surface">{s.name}</td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                    {/* The outer window alone hides that a split shift is not
                        continuous, so list the slots that make it up. */}
                    {s.is_split && s.segments.length > 0 && (
                      <div className="mt-0.5 text-xs text-outline">
                        {s.segments.map((seg) => `${seg.start_time.slice(0, 5)}–${seg.end_time.slice(0, 5)}`).join(' + ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{s.grace_minutes}m</td>
                  <td className="px-4 py-3 text-on-surface-variant">{s.min_half_day_minutes}m / {s.min_full_day_minutes}m</td>
                  <td className="px-4 py-3 text-on-surface-variant">{s.is_night_shift ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.is_active ? 'bg-status-success-container text-on-status-success-container' : 'bg-surface-container text-on-surface-variant'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button onClick={() => { setEditing(s); setFormOpen(true); }}>Edit</Button>
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
    </PageSection>
  );
}
