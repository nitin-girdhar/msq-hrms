'use client';

// Per-employee attendance photo viewer for the Team screen. Shows the enrolled
// reference photo and lets the viewer LOAD each punch's selfie on demand (never
// auto-loaded — that is a deliberate privacy choice). Each punch selfie is shown
// with its captured time and device location overlaid (the pixels themselves are
// never stamped). Admins can replace the reference photo here with no cooldown.
//
// The punch list comes from /hr/attendance/events rather than the two event ids
// on the team row. Those are pinned to the day's first_in and last_out, so on a
// split shift the middle punches — including the second-segment check-in, where
// buddy-punching happens — were stored but had no addressable id and could not
// be viewed at all.

import { useEffect, useState } from 'react';
import { Modal, PhotoUploadModal, PhotoAvatar, users as usersApi } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { TeamDayRow, DayEventView } from '../../lib/attendance/types';
import { formatClockTime } from '../../lib/attendance/format';

interface Props {
  row: TeamDayRow | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function fmtLoc(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function PunchPhoto({ event }: { event: DayEventView }) {
  const [show, setShow] = useState(false);
  const [failed, setFailed] = useState(false);

  const label = event.event_type === 'check_in' ? 'Check-in' : 'Check-out';
  const loc = fmtLoc(event.geo_lat, event.geo_lng);
  const pending = event.face_review_status === 'pending';
  const rejected = event.face_review_status === 'rejected';

  return (
    <div className="w-40 shrink-0">
      <p className="mb-1 flex items-baseline gap-1.5 text-xs font-semibold text-[#64748B]">
        <span>{label}</span>
        <span className="font-normal text-[#94A3B8]">{formatClockTime(event.occurred_at)}</span>
      </p>

      {/* Photos are only half the story — a punch can be flagged, thrown out, or
          made from the wrong place, and the reviewer needs that beside the face. */}
      <div className="mb-1 flex flex-wrap gap-x-1.5 text-[10px] leading-tight">
        {event.face_match_score != null && (
          <span className={pending ? 'font-semibold text-amber-700' : 'text-[#64748B]'}>
            {Math.round(event.face_match_score)}%
          </span>
        )}
        {pending && <span className="font-semibold text-amber-700">Awaiting review</span>}
        {rejected && <span className="font-semibold text-red-700">Rejected</span>}
        {event.is_off_segment && <span className="text-amber-700">Outside window</span>}
        {event.is_within_geofence === false && <span className="text-red-700">Outside geofence</span>}
      </div>

      {!event.has_photo ? (
        <p className="rounded-lg border border-dashed border-[#E2E8F0] py-5 text-center text-[11px] text-[#94A3B8]">
          No photo
        </p>
      ) : failed ? (
        // Retention deletes the blob but leaves photo_url set, so has_photo can
        // be true for an image that no longer exists.
        <p className="rounded-lg border border-dashed border-[#E2E8F0] py-5 text-center text-[11px] text-[#94A3B8]">
          Photo unavailable
        </p>
      ) : show ? (
        <div className="relative overflow-hidden rounded-lg bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attendanceApi.photoUrl(event.event_id)}
            alt={`${label} selfie`}
            onError={() => setFailed(true)}
            className="w-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[10px] leading-tight text-white">
            <div>{formatClockTime(event.occurred_at)}</div>
            {loc && <div className="opacity-80">📍 {loc}</div>}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShow(true)}
          className="w-full rounded-lg border border-dashed border-[#CBD5E1] py-6 text-xs font-medium text-[#0b6cbf] hover:bg-slate-50"
        >
          Load photo
        </button>
      )}
    </div>
  );
}

export default function TeamPhotoModal({ row, canManage, onClose, onChanged }: Props) {
  const [changeOpen, setChangeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<DayEventView[] | null>(null);

  const userId = row?.user_id;
  const workDate = row?.work_date;

  useEffect(() => {
    if (!userId || !workDate) {
      setEvents(null);
      return;
    }
    let active = true;
    setEvents(null);
    attendanceApi
      .dayEvents({ user_id: userId, date: workDate })
      .then((res) => { if (active) setEvents(res.data); })
      // An empty list renders as "No punches", which is the honest outcome for a
      // failed load here — the reference photo and actions still work.
      .catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [userId, workDate]);

  if (!row) return null;

  const handleChange = async (dataUrl: string, consent: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await usersApi.uploadPhoto(row.user_id, { photo: dataUrl, consent });
      // Admin re-enroll — the service bypasses the cooldown for managers.
      await attendanceApi.face.enroll({ user_id: row.user_id, consent });
      setChangeOpen(false);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the photo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={!!row && !changeOpen} onClose={onClose} title={row.user_full_name} maxWidth="max-w-lg">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {row.has_photo ? (
              <PhotoAvatar src={attendanceApi.face.referenceUrl(row.user_id)} label={row.user_full_name} sizeClass="h-16 w-16" />
            ) : (
              <PhotoAvatar src={null} label={row.user_full_name} sizeClass="h-16 w-16" />
            )}
            <div className="text-xs text-[#64748B]">
              <p className="font-semibold text-[#0F172A]">Reference photo</p>
              <p>{row.has_photo ? (row.enrolled ? 'Enrolled for face matching' : 'Photo on file (not enrolled)') : 'No photo on file'}</p>
              {row.face_match_score != null && <p className="mt-0.5">Today’s match: {Math.round(row.face_match_score)}%</p>}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-[#0F172A]">
              Punches{events && events.length > 0 ? ` (${events.length})` : ''}
            </p>
            {events === null ? (
              <p className="text-xs text-[#94A3B8]">Loading punches…</p>
            ) : events.length === 0 ? (
              <p className="text-xs text-[#94A3B8]">No punches recorded for this day.</p>
            ) : (
              // Horizontal scroll rather than a wrapping grid: a split shift can
              // run to six punches and the modal must not grow unboundedly.
              <div className="flex gap-3 overflow-x-auto pb-1">
                {events.map((e) => (
                  <PunchPhoto key={e.event_id} event={e} />
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            {canManage && (
              <button
                type="button"
                onClick={() => setChangeOpen(true)}
                disabled={busy}
                className="rounded-lg bg-[#0b6cbf] px-3 py-2 text-sm font-medium text-white hover:bg-[#0a5da3] disabled:opacity-50"
              >
                Change photo
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[#475569] hover:bg-slate-50">
              Close
            </button>
          </div>
        </div>
      </Modal>

      <PhotoUploadModal
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        title={`Change photo — ${row.user_full_name}`}
        consentLabel="I confirm this employee consents to their photo being stored and used to verify attendance."
        onSubmit={handleChange}
      />
    </>
  );
}
