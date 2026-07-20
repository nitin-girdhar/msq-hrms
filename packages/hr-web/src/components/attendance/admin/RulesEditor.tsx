'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@crm/types';
import { attendance as attendanceApi } from '../../../lib/api/client';
import { orgs as orgsApi } from '@platform/ui-kit';
import type { AttendanceRules } from '../../../lib/attendance/types';
import { canSetOrgLocation } from '../../../lib/attendance/format';
import { useGeolocation } from '../../../hooks/useGeolocation';

interface Props {
  actor: SessionUser;
  onNotice: (msg: string) => void;
}

interface OrgLocation {
  geoLat: number | null | undefined;
  geoLng: number | null | undefined;
}

export default function RulesEditor({ actor, onNotice }: Props) {
  const [rules, setRules] = useState<AttendanceRules | null>(null);
  const [orgLoc, setOrgLoc] = useState<OrgLocation | null>(null);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingGeo, setSavingGeo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geo = useGeolocation();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([attendanceApi.getRules(), orgsApi.list()])
      .then(([rulesRes, orgsRes]) => {
        setRules(rulesRes.data);
        const mine = orgsRes.data.find((o) => o.org_id === actor.org_id || o.id === actor.org_id);
        setOrgLoc(mine ? { geoLat: mine.geoLat, geoLng: mine.geoLng } : null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load attendance rules.'))
      .finally(() => setLoading(false));
  }, [actor.org_id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (geo.state.status === 'success') {
      setLat(String(geo.state.coords.lat));
      setLng(String(geo.state.coords.lng));
    }
  }, [geo.state]);

  const save = async () => {
    if (!rules) return;
    setError(null);
    setSaving(true);
    try {
      const res = await attendanceApi.updateRules(rules);
      setRules(res.data);
      onNotice('Attendance rules saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save attendance rules.');
    } finally {
      setSaving(false);
    }
  };

  const saveGeo = async () => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      setError('Enter valid coordinates.');
      return;
    }
    setError(null);
    setSavingGeo(true);
    try {
      await orgsApi.updateGeo(actor.org_id, { geo_lat: latNum, geo_lng: lngNum });
      onNotice('Organization location saved.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the organization location.');
    } finally {
      setSavingGeo(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>;
  if (!rules) return null;

  const locationMissing = orgLoc && (orgLoc.geoLat == null || orgLoc.geoLng == null);

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20';

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {locationMissing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">Organization location isn't set.</p>
          <p className="mt-1 text-xs">Geofenced check-in cannot work until an org admin sets the office coordinates below.</p>
        </div>
      )}

      {canSetOrgLocation(actor.rank) ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Organization location</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="re-lat" className="text-xs font-semibold text-[#0F172A]">Latitude</label>
              <input id="re-lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder={orgLoc?.geoLat != null ? String(orgLoc.geoLat) : '—'} className={inputCls} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="re-lng" className="text-xs font-semibold text-[#0F172A]">Longitude</label>
              <input id="re-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder={orgLoc?.geoLng != null ? String(orgLoc.geoLng) : '—'} className={inputCls} />
            </div>
            <button type="button" onClick={geo.request} className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC]">
              Use my current location
            </button>
            <button type="button" onClick={saveGeo} disabled={savingGeo} className="rounded-xl bg-[#0b6cbf] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60">
              {savingGeo ? 'Saving…' : 'Save location'}
            </button>
          </div>
          {geo.state.status === 'error' && <p className="mt-2 text-xs text-red-600">{geo.state.message}</p>}
        </div>
      ) : (
        locationMissing && <p className="text-xs text-[#94A3B8]">Only an org admin can set the organization location.</p>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-[#E2E8F0] bg-white p-4 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-3 text-sm text-[#0F172A]">
          <span>Geofence enabled</span>
          <input type="checkbox" checked={rules.geofence_enabled} onChange={(e) => setRules({ ...rules, geofence_enabled: e.target.checked })} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="re-radius" className="text-xs font-semibold text-[#0F172A]">Geofence radius (meters)</label>
          <input id="re-radius" type="number" min={1} value={rules.geofence_radius_meters} onChange={(e) => setRules({ ...rules, geofence_radius_meters: Number(e.target.value) })} className={inputCls} />
        </div>
        <label className="flex items-center justify-between gap-3 text-sm text-[#0F172A]">
          <span>Require geolocation</span>
          <input type="checkbox" checked={rules.require_geo} onChange={(e) => setRules({ ...rules, require_geo: e.target.checked })} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-[#0F172A]">
          <span>Require photo</span>
          <input type="checkbox" checked={rules.require_photo} onChange={(e) => setRules({ ...rules, require_photo: e.target.checked })} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-[#0F172A]">
          <span>Allow WFH check-in</span>
          <input type="checkbox" checked={rules.allow_wfh_checkin} onChange={(e) => setRules({ ...rules, allow_wfh_checkin: e.target.checked })} className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf]" />
        </label>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-[#0b6cbf] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60">
          {saving ? 'Saving…' : 'Save rules'}
        </button>
      </div>
    </div>
  );
}
