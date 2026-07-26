'use client';

// Per-employee attendance photo viewer for the Team screen. Shows the enrolled
// reference photo and lets the viewer LOAD each day's check-in / check-out selfie
// on demand (never auto-loaded — that is a deliberate privacy choice). Each punch
// selfie is shown with its captured time and device location overlaid (the pixels
// themselves are never stamped). Admins can replace the reference photo here with
// no cooldown.

import { useState } from 'react';
import { Modal, PhotoUploadModal, PhotoAvatar, users as usersApi } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { TeamDayRow } from '../../lib/attendance/types';
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

function PunchPhoto({
  eventId,
  time,
  loc,
  label,
}: {
  eventId: string | null;
  time: string | null;
  loc: string | null;
  label: string;
}) {
  const [show, setShow] = useState(false);
  if (!eventId) {
    return (
      <div className="flex-1">
        <p className="mb-1 text-xs font-semibold text-[#64748B]">{label}</p>
        <p className="text-xs text-[#94A3B8]">No {label.toLowerCase()} photo.</p>
      </div>
    );
  }
  return (
    <div className="flex-1">
      <p className="mb-1 text-xs font-semibold text-[#64748B]">{label}</p>
      {show ? (
        <div className="relative overflow-hidden rounded-lg bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attendanceApi.photoUrl(eventId)} alt={`${label} selfie`} className="w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[10px] leading-tight text-white">
            <div>{formatClockTime(time)}</div>
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

          <div className="flex gap-3">
            <PunchPhoto eventId={row.checkin_event_id} time={row.first_in} loc={fmtLoc(row.checkin_lat, row.checkin_lng)} label="Check-in" />
            <PunchPhoto eventId={row.checkout_event_id} time={row.last_out} loc={fmtLoc(row.checkout_lat, row.checkout_lng)} label="Check-out" />
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
