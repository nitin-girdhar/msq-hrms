'use client';

import { useEffect, useRef, useState } from 'react';
import { attendance as attendanceApi } from '../../lib/api/client';
import type { ActiveGeoException, AttendanceRules, PunchResult } from '../../lib/attendance/types';
import { describePunchError, formatDay } from '../../lib/attendance/format';
import { geofenceVerdict } from '../../lib/attendance/geo';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useCameraCapture } from '../../hooks/useCameraCapture';
import StatusPill from '../common/StatusPill';

interface Props {
  mode: 'check_in' | 'check_out';
  rules: AttendanceRules;
  /** Non-null when this employee may punch from outside the geofence today. */
  geoException: ActiveGeoException | null;
  onClose: () => void;
  onSuccess: (result: PunchResult) => void;
}

/**
 * Check in / check out on the page itself (Stitch "Attendance Punch & Regularization Hub"): a selfie card and a
 * location card side by side, the distance from the office before you commit, then one confirm button. It lives
 * only while a punch is in progress: mounting starts the location request and the camera, unmounting stops both.
 * The server still decides everything (geofence, photo, face match); this panel shows what it will see.
 */
export default function PunchPanel({ mode, rules, geoException, onClose, onSuccess }: Props) {
  const geo = useGeolocation();
  const camera = useCameraCapture();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const [isWfh, setIsWfh] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    geo.request();
    if (camera.isSupported) void camera.start();
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return () => { camera.stop(); geo.reset(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const position = geo.state.status === 'success' ? { lat: geo.state.coords.lat, lng: geo.state.coords.lng } : null;
  const verdict = geofenceVerdict(position, { lat: rules.office_lat, lng: rules.office_lng }, rules.geofence_radius_meters);
  const geoOk = geo.state.status === 'success';
  const photoOk = camera.state.status === 'captured';
  const blocked = submitting || (rules.require_geo && !geoOk) || (rules.require_photo && !photoOk) || geo.state.status === 'prompting';
  const title = mode === 'check_in' ? 'Check in' : 'Check out';

  const cancel = () => { if (!submitting) onClose(); };

  const submit = async () => {
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

  const card = 'rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm';

  return (
    <section ref={rootRef} aria-label={title} className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-surface-container-low p-4 shadow-sm sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-on-surface">{title}</h2>
          <p className="text-xs text-on-surface-variant">Take a selfie and confirm where you are. Nothing is recorded until you confirm.</p>
        </div>
        <button type="button" onClick={cancel} disabled={submitting} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-60">Cancel</button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}

      {geoException ? (
        <div className="rounded-xl border border-cat-indigo/30 bg-cat-indigo-container px-3 py-2 text-xs text-on-cat-indigo-container">
          {geoException.exception_type === 'wfh'
            ? <><span className="font-semibold">Approved work from home</span>{geoException.effective_to ? ` until ${formatDay(geoException.effective_to)}` : ''}. This punch will be recorded as work from home.</>
            : <><span className="font-semibold">Remote check-in is enabled for you</span>{geoException.effective_to ? ` until ${formatDay(geoException.effective_to)}` : ''}. You can check in from anywhere.</>}{' '}
          Your location is still recorded.
        </div>
      ) : rules.allow_wfh_checkin && (
        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input type="checkbox" checked={isWfh} onChange={(e) => setIsWfh(e.target.checked)} disabled={submitting} className="h-4 w-4 rounded border-outline-variant text-primary" />
          <span>Working from home</span>
        </label>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-2">
        {/* Selfie */}
        <div className={card}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-on-surface">Selfie</h3>
            {camera.state.status === 'captured' ? <StatusPill tone="success" dot>Photo captured</StatusPill>
              : camera.state.status === 'streaming' ? <StatusPill tone="info" dot>Camera live</StatusPill>
              : camera.state.status === 'error' ? <StatusPill tone="overdue">Camera problem</StatusPill>
              : <StatusPill>{rules.require_photo ? 'Photo needed' : 'Photo optional'}</StatusPill>}
          </div>
          {camera.state.status === 'captured' ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={camera.state.dataUrl} alt="Your captured selfie" className="aspect-[4/3] w-full rounded-lg border border-outline-variant object-cover" />
              <button type="button" onClick={camera.retake} disabled={submitting} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">Retake</button>
            </div>
          ) : camera.isSupported ? (
            <div className="space-y-2">
              <video ref={camera.videoRef} muted playsInline className="aspect-[4/3] w-full rounded-lg border border-outline-variant bg-inverse-surface object-cover" />
              {camera.state.status === 'error' && <p className="text-xs text-status-overdue">{camera.state.message}</p>}
              <button type="button" onClick={camera.capture} disabled={submitting || camera.state.status !== 'streaming'} className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">Capture photo</button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-on-surface-variant">Camera capture is not available on this device. Choose or take a photo instead.</p>
              <input ref={fileInputRef} type="file" accept="image/*" capture="user" onChange={(e) => { const f = e.target.files?.[0]; if (f) void camera.fromFile(f); }} disabled={submitting} className="w-full text-xs" />
            </div>
          )}
          {!rules.require_photo && <p className="mt-2 text-label-sm text-outline">Optional for this organization.</p>}
        </div>

        {/* Location and geofence */}
        <div className={card}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-on-surface">Location &amp; geofence</h3>
            {geo.state.status === 'prompting' || geo.state.status === 'idle' ? <StatusPill tone="info">Locating…</StatusPill>
              : geo.state.status === 'error' ? <StatusPill tone="overdue">Location problem</StatusPill>
              : verdict.kind === 'within' ? <StatusPill tone="success" dot>Within geofence</StatusPill>
              : verdict.kind === 'outside' ? <StatusPill tone={geoException ? 'info' : 'due'} dot>{geoException ? 'Outside, exempt' : 'Outside geofence'}</StatusPill>
              : <StatusPill tone="success" dot>Location captured</StatusPill>}
          </div>

          {geo.state.status === 'error' ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-status-overdue">{geo.state.message}</p>
              {!geo.state.unavailable && <button type="button" onClick={geo.request} className="shrink-0 rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low">Retry</button>}
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-surface-container-low px-3 py-2">
                <dt className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Distance from office</dt>
                <dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-on-surface">{verdict.kind === 'unknown' ? '—' : `${verdict.meters} m`}</dd>
              </div>
              <div className="rounded-lg bg-surface-container-low px-3 py-2">
                <dt className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Allowed radius</dt>
                <dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-on-surface">{rules.geofence_enabled ? `${rules.geofence_radius_meters} m` : 'Not enforced'}</dd>
              </div>
              <div className="col-span-2 rounded-lg bg-surface-container-low px-3 py-2">
                <dt className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">GPS fix</dt>
                <dd className="mt-0.5 text-on-surface">
                  {geo.state.status === 'success'
                    ? `${geo.state.coords.lat.toFixed(5)}, ${geo.state.coords.lng.toFixed(5)}${geo.state.coords.accuracy != null ? ` (accurate to ±${Math.round(geo.state.coords.accuracy)} m)` : ''}`
                    : 'Waiting for your device…'}
                </dd>
              </div>
            </dl>
          )}
          {verdict.kind === 'outside' && !geoException && rules.geofence_enabled && (
            <p className="mt-2 rounded-lg bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
              You are {verdict.meters - verdict.radius} m beyond the allowed radius. The server will refuse this punch unless you move closer.
            </p>
          )}
          {!rules.require_geo && <p className="mt-2 text-label-sm text-outline">Optional for this organization.</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={cancel} disabled={submitting} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-60">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={blocked} aria-busy={submitting}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
          {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-primary/40 border-t-on-primary" aria-hidden />}
          {submitting ? 'Submitting…' : `Confirm ${mode === 'check_in' ? 'check-in' : 'check-out'}`}
        </button>
      </div>
    </section>
  );
}
