'use client';

import { useEffect, useState } from 'react';
import { Button, exportRows } from '@platform/ui-kit';
import { attendanceTools } from '../../lib/api/client';
import type { PunchLogRow } from '../../lib/h7/types';
import { formatDateTime } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, stateBlockCls } from '../../lib/ui';

const SOURCE_LABEL: Record<string, string> = { web: 'Web', mobile: 'Mobile', biometric: 'Biometric', api: 'API', manual: 'Added by HR' };

function fenceBadge(p: PunchLogRow) {
  if (p.geo_exception_type) return { text: p.geo_exception_type === 'wfh' ? 'Work from home' : 'Field role', cls: 'bg-status-info-container text-on-status-info-container' };
  if (p.is_within_geofence === true) return { text: 'Inside geofence', cls: 'bg-status-success-container text-on-status-success-container' };
  if (p.is_within_geofence === false) return { text: 'Outside geofence', cls: 'bg-status-overdue-container text-on-status-overdue-container' };
  return { text: 'No location', cls: 'bg-surface-container text-on-surface-variant' };
}

function faceText(p: PunchLogRow): string {
  if (p.face_review_status === 'pending') return 'Awaiting review';
  if (p.face_review_status === 'rejected') return 'Rejected';
  if (p.face_match_score == null) return '—';
  return `${Math.round(p.face_match_score)}%${p.face_match_passed === false ? ' · below threshold' : ''}`;
}

/**
 * "Biometric & geofence logs" (Stitch timesheet tab): every punch of a month with where it
 * was made from, how far from the office, and how the face check went. Only the signed-in
 * employee's own punches — the server pins the query to the verified caller.
 */
export default function PunchLog() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<PunchLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    attendanceTools.punches(month).then((r) => setRows(r.data)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load your punches.'));
  }, [month]);

  // The month filter is applied to the org-local date of each punch by the server window; trim the
  // one-day margin it fetches so the list shows exactly the chosen month.
  const shown = (rows ?? []).filter((r) => r.occurred_at.startsWith(month) || new Date(r.occurred_at).toLocaleDateString('en-CA').startsWith(month));

  const download = () =>
    exportRows(shown, [
      { header: 'When', value: (r) => formatDateTime(r.occurred_at) },
      { header: 'Type', value: (r) => (r.event_type === 'check_in' ? 'Check in' : 'Check out') },
      { header: 'Source', value: (r) => SOURCE_LABEL[r.source] ?? r.source },
      { header: 'Distance from office (m)', value: (r) => r.distance_from_org_m },
      { header: 'Location', value: (r) => fenceBadge(r).text },
      { header: 'Face check', value: (r) => faceText(r) },
    ], `my-punches-${month}`, 'csv');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" className={`${fieldInputCls} w-44`} />
        <Button variant="secondary" onClick={download} disabled={shown.length === 0}>Export CSV</Button>
      </div>
      {error && <p role="alert" className="text-xs text-on-status-overdue-container">{error}</p>}
      {rows === null && !error ? <div className={stateBlockCls}>Loading…</div> : shown.length === 0 ? (
        <p className={emptyBlockCls}>No punches in this month.</p>
      ) : (
        <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          {shown.map((p) => {
            const f = fenceBadge(p);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">
                    {p.event_type === 'check_in' ? 'Check in' : 'Check out'}
                    <span className="ml-2 font-normal tabular-nums text-on-surface-variant">{formatDateTime(p.occurred_at)}</span>
                  </p>
                  <p className="text-label-sm text-outline">
                    {SOURCE_LABEL[p.source] ?? p.source}
                    {p.distance_from_org_m != null ? ` · ${Math.round(p.distance_from_org_m)} m from the office` : ''}
                    {p.is_off_segment ? ' · outside the shift window' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-label-sm font-medium ${f.cls}`}>{f.text}</span>
                  <span className="text-label-sm text-on-surface-variant">Face: {faceText(p)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
