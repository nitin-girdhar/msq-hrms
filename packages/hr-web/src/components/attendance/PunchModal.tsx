'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { PunchResult } from '../../lib/attendance/types';
import type { AttendanceRules } from '../../lib/attendance/types';
import { describePunchError } from '../../lib/attendance/format';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useCameraCapture } from '../../hooks/useCameraCapture';

interface Props {
  open: boolean;
  mode: 'check_in' | 'check_out';
  rules: AttendanceRules;
  onClose: () => void;
  onSuccess: (result: PunchResult) => void;
}

export default function PunchModal({ open, mode, rules, onClose, onSuccess }: Props) {
  const geo = useGeolocation();
  const camera = useCameraCapture();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isWfh, setIsWfh] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIsWfh(false);
    setError(null);
    geo.request();
    if (camera.isSupported) void camera.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    camera.stop();
    geo.reset();
    onClose();
  };

  const geoOk = geo.state.status === 'success';
  const geoBlocking = rules.require_geo && !geoOk;
  const photoOk = camera.state.status === 'captured';
  const photoBlocking = rules.require_photo && !photoOk;

  const blockSubmit = submitting || geoBlocking || photoBlocking || geo.state.status === 'prompting';

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (file) void camera.fromFile(file);
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        geo_lat: geo.state.status === 'success' ? geo.state.coords.lat : undefined,
        geo_lng: geo.state.status === 'success' ? geo.state.coords.lng : undefined,
        geo_accuracy_m: geo.state.status === 'success' ? (geo.state.coords.accuracy ?? undefined) : undefined,
        photo: camera.state.status === 'captured' ? camera.state.dataUrl : undefined,
        source: 'web' as const,
        is_wfh: isWfh,
      };
      const res = mode === 'check_in' ? await attendanceApi.checkIn(body) : await attendanceApi.checkOut(body);
      camera.stop();
      onSuccess(res.data);
    } catch (err) {
      setError(describePunchError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'check_in' ? 'Check in' : 'Check out';

  return (
    <Modal open={open} onClose={handleClose} title={title} locked={submitting} maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {rules.allow_wfh_checkin && (
          <label className="flex items-center gap-2 text-sm text-[#0F172A]">
            <input
              type="checkbox"
              checked={isWfh}
              onChange={(e) => setIsWfh(e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]"
            />
            <span>Working from home</span>
          </label>
        )}

        {/* ── Location ─────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Location</p>
          {geo.state.status === 'idle' && <span className="text-xs text-[#94A3B8]">Waiting…</span>}
          {geo.state.status === 'prompting' && (
            <span className="inline-flex items-center gap-2 text-xs text-[#64748B]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#0b6cbf]/30 border-t-[#0b6cbf]" aria-hidden />
              Getting your location…
            </span>
          )}
          {geo.state.status === 'success' && (
            <span className="text-xs text-green-700">
              Location captured{geo.state.coords.accuracy != null ? ` (±${Math.round(geo.state.coords.accuracy)}m)` : ''}.
            </span>
          )}
          {geo.state.status === 'error' && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-red-600">{geo.state.message}</span>
              {!geo.state.unavailable && (
                <button type="button" onClick={geo.request} className="shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#F8FAFC]">
                  Retry
                </button>
              )}
            </div>
          )}
          {!rules.require_geo && <p className="mt-1 text-[11px] text-[#94A3B8]">Optional for this organization.</p>}
        </div>

        {/* ── Photo ────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Photo</p>

          {camera.state.status === 'captured' ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={camera.state.dataUrl} alt="Captured" className="mx-auto max-h-48 rounded-lg border border-[#E2E8F0]" />
              <button type="button" onClick={camera.retake} disabled={submitting} className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
                Retake
              </button>
            </div>
          ) : camera.isSupported ? (
            <div className="space-y-2">
              <video ref={camera.videoRef} muted playsInline className="mx-auto max-h-48 w-full rounded-lg border border-[#E2E8F0] bg-black object-cover" />
              {camera.state.status === 'error' && <p className="text-xs text-red-600">{camera.state.message}</p>}
              <button
                type="button"
                onClick={camera.capture}
                disabled={submitting || camera.state.status !== 'streaming'}
                className="w-full rounded-lg bg-[#0b6cbf] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Capture photo
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[#64748B]">Camera capture isn't available on this device.</p>
              <input ref={fileInputRef} type="file" accept="image/*" capture="user" onChange={handleFileChange} disabled={submitting} className="w-full text-xs" />
            </div>
          )}
          {!rules.require_photo && <p className="mt-1 text-[11px] text-[#94A3B8]">Optional for this organization.</p>}
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={handleClose} disabled={submitting} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={blockSubmit}
            aria-busy={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {submitting ? 'Submitting…' : title}
          </button>
        </div>
      </div>
    </Modal>
  );
}
