'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser } from '@platform/types';
import { attendance as attendanceApi } from '../../../lib/api/client';
import { orgs as orgsApi, Alert, Button, PageSection } from '@platform/ui-kit';
import type { AttendanceRules } from '../../../lib/attendance/types';
import { canSetOrgLocation, canManageTenantAttendance, todayIso, shiftIso } from '../../../lib/attendance/format';
import { fieldInputCls, fieldLabelCls, stateBlockCls } from '../../../lib/ui';
import { useGeolocation } from '../../../hooks/useGeolocation';

interface Props {
  actor: SessionUser;
  onNotice: (msg: string) => void;
}

// The saved server state this form is diffed against, so the footer can say
// whether anything is actually pending and the save can skip the endpoint whose
// half of the form is untouched.
interface Baseline {
  rules: AttendanceRules;
  lat: string;
  lng: string;
}

const inputCls = `${fieldInputCls} tabular-nums`;

// Checkbox first, then label and description, all inside one clickable row.
// The previous layout put the label hard left and the checkbox hard right of a
// full-width row, so at desktop width ~1000px of dead space separated a control
// from the thing it controlled and every row looked like a separate section.
function ToggleRow({
  id, label, description, checked, onChange, children,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-[#F1F5F9] py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#CBD5E1] text-[#0b6cbf] focus:ring-2 focus:ring-[#0b6cbf]/20"
        />
        <div className="min-w-0">
          <label htmlFor={id} className="block cursor-pointer text-sm font-medium text-[#0F172A]">
            {label}
          </label>
          <p className="mt-0.5 text-xs text-[#64748B]">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function RulesEditor({ actor, onNotice }: Props) {
  const [rules, setRules] = useState<AttendanceRules | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which row the save writes: this org's override, or the tenant-wide default
  // every other org inherits. Deliberately NOT part of `rules` — it is not a
  // saved value, so folding it in would make the form look dirty on its own and
  // would make the baseline diff meaningless.
  const [scope, setScope] = useState<'org' | 'tenant'>('org');

  const geo = useGeolocation();
  const canSetLocation = canSetOrgLocation(actor.rank);
  const canSetTenantWide = canManageTenantAttendance(actor.rank);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([attendanceApi.getRules(), orgsApi.list()])
      .then(([rulesRes, orgsRes]) => {
        const mine = orgsRes.data.find((o) => o.org_id === actor.org_id || o.id === actor.org_id);
        // Seed the inputs with the saved coordinates rather than leaving them
        // blank behind a placeholder: a greyed-out placeholder reads as "not
        // set", so a configured office looked unconfigured.
        const nextLat = mine?.geoLat != null ? String(mine.geoLat) : '';
        const nextLng = mine?.geoLng != null ? String(mine.geoLng) : '';
        setRules(rulesRes.data);
        setLat(nextLat);
        setLng(nextLng);
        setBaseline({ rules: rulesRes.data, lat: nextLat, lng: nextLng });
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

  if (loading) return <div className={stateBlockCls}>Loading…</div>;
  if (!rules || !baseline) return null;

  const locationSet = baseline.lat !== '' && baseline.lng !== '';
  const geoDirty = canSetLocation && (lat !== baseline.lat || lng !== baseline.lng);
  const rulesDirty = JSON.stringify(rules) !== JSON.stringify(baseline.rules);
  const dirty = geoDirty || rulesDirty;
  // The oldest work_date a regularization may still name, resolved for display.
  // Showing the actual date is what makes the window concrete — "30 days" is an
  // abstraction an admin has to do arithmetic on.
  const earliestWorkDate = shiftIso(todayIso(rules.timezone), -rules.regularization_max_backdate_days);
  // Mirrors the server-side superRefine and the DB CHECK: a half-day floor above
  // the full-day floor would make 'half_day' unreachable.
  const thresholdOrderInvalid = rules.min_half_day_minutes > rules.min_full_day_minutes;

  const save = async () => {
    setError(null);

    // Validated before either request so a bad coordinate cannot leave the two
    // endpoints half-applied.
    let coords: { lat: number; lng: number } | null = null;
    if (geoDirty) {
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (lat.trim() === '' || lng.trim() === '' || Number.isNaN(latNum) || Number.isNaN(lngNum)) {
        setError('Enter both a latitude and a longitude.');
        return;
      }
      if (latNum < -90 || latNum > 90) { setError('Latitude must be between -90 and 90.'); return; }
      if (lngNum < -180 || lngNum > 180) { setError('Longitude must be between -180 and 180.'); return; }
      coords = { lat: latNum, lng: lngNum };
    }

    setSaving(true);
    try {
      if (coords) await orgsApi.updateGeo(actor.org_id, { geo_lat: coords.lat, geo_lng: coords.lng });
      if (rulesDirty) await attendanceApi.updateRules({ ...rules, scope });
      const tenantWide = rulesDirty && scope === 'tenant';
      onNotice(
        coords && rulesDirty ? `Location and check-in rules saved${tenantWide ? ' for every organization' : ''}.`
          : coords ? 'Organization location saved.'
            : `Check-in rules saved${tenantWide ? ' for every organization' : ''}.`,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      {error && (
        <Alert tone="error">{error}</Alert>
      )}

      {/* Scope first, above every field it governs: an admin needs to know
          whether they are editing one org or all of them BEFORE they start
          typing, not when they reach the save button. */}
      {canSetTenantWide && (
        <PageSection title="Apply to">
          <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="re-scope" className={fieldLabelCls}>These settings apply to</label>
              <select
                id="re-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as 'org' | 'tenant')}
                className={`${inputCls} w-72 pr-8`}
              >
                <option value="org">This organization only</option>
                <option value="tenant">All organizations (tenant-wide default)</option>
              </select>
            </div>
            <p className="mt-2 text-xs text-[#64748B]">
              {scope === 'tenant'
                ? 'Saves the tenant-wide default. Organizations that have their own settings keep them — this only changes what the rest inherit.'
                : 'Saves an override for this organization only, leaving the tenant-wide default untouched.'}
            </p>
          </div>
        </PageSection>
      )}

      {!locationSet && canSetLocation && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Set the office coordinates below — geofenced check-in stays off until they exist.
        </div>
      )}

      {canSetLocation && (
        <PageSection title="Organization location">
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="re-lat" className={fieldLabelCls}>Latitude</label>
                <input
                  id="re-lat" value={lat} onChange={(e) => setLat(e.target.value)}
                  inputMode="decimal" placeholder="28.393895"
                  className={`${inputCls} w-36`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="re-lng" className={fieldLabelCls}>Longitude</label>
                <input
                  id="re-lng" value={lng} onChange={(e) => setLng(e.target.value)}
                  inputMode="decimal" placeholder="76.965164"
                  className={`${inputCls} w-36`}
                />
              </div>
              <Button
                size="md"
                onClick={geo.request}
                disabled={geo.state.status === 'prompting'}
                className="h-10"
              >
                {geo.state.status === 'prompting' ? 'Locating…' : 'Use my current location'}
              </Button>
            </div>

            <p className="mt-2.5 text-xs text-[#64748B]">
              {geo.state.status === 'error' ? (
                <span className="text-red-600">{geo.state.message}</span>
              ) : geo.state.status === 'success' && geo.state.coords.accuracy != null ? (
                `Captured to about ${Math.round(geo.state.coords.accuracy)} m — review before saving.`
              ) : (
                'The centre point of the check-in geofence.'
              )}
            </p>
          </div>
        </PageSection>
      )}

      {!canSetLocation && !locationSet && (
        <p className="text-xs text-[#94A3B8]">Only an org admin can set the organization location.</p>
      )}

      <PageSection title="Check-in rules">
        <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-1">
          <ToggleRow
            id="re-geofence"
            label="Geofence enabled"
            description="Only accept a check-in made within range of the office."
            checked={rules.geofence_enabled}
            onChange={(v) => setRules({ ...rules, geofence_enabled: v })}
          >
            {/* Nested under its own toggle: the radius only means anything while
                geofencing is on, and as a sibling field it read as an unrelated
                setting stretched across the full card width. */}
            <div className="mt-2.5 flex items-center gap-2">
              <label htmlFor="re-radius" className={fieldLabelCls}>Radius</label>
              <input
                id="re-radius" type="number" min={1} step={10}
                value={rules.geofence_radius_meters}
                onChange={(e) => setRules({ ...rules, geofence_radius_meters: Number(e.target.value) })}
                disabled={!rules.geofence_enabled}
                className={`${inputCls} w-24`}
              />
              <span className={`text-xs ${rules.geofence_enabled ? 'text-[#64748B]' : 'text-[#CBD5E1]'}`}>
                meters
              </span>
            </div>
          </ToggleRow>

          <ToggleRow
            id="re-require-geo"
            label="Require geolocation"
            description="Check-in is refused if the device will not share a location."
            checked={rules.require_geo}
            onChange={(v) => setRules({ ...rules, require_geo: v })}
          />
          <ToggleRow
            id="re-require-photo"
            label="Require photo"
            description="Employees capture a selfie as part of checking in."
            checked={rules.require_photo}
            onChange={(v) => setRules({ ...rules, require_photo: v })}
          />
          <ToggleRow
            id="re-wfh"
            label="Allow WFH check-in"
            description="Lets employees check in from outside the geofence."
            checked={rules.allow_wfh_checkin}
            onChange={(v) => setRules({ ...rules, allow_wfh_checkin: v })}
          />
        </div>
      </PageSection>

      <PageSection title="Day classification">
        <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-4">
          <p className="text-xs text-[#64748B]">
            How much time an employee must actually work for a day to count. Time is
            the total of every check-in/check-out session, so a break punched out and
            back in is not counted. Employees on a shift use their shift&apos;s own
            figures; these apply to everyone without a shift assignment.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="re-half-day" className={fieldLabelCls}>Half day from</label>
              <div className="flex items-center gap-2">
                <input
                  id="re-half-day" type="number" min={0} max={1440} step={15}
                  value={rules.min_half_day_minutes}
                  onChange={(e) => setRules({ ...rules, min_half_day_minutes: Number(e.target.value) })}
                  className={`${inputCls} w-24`}
                />
                <span className="text-xs text-[#64748B]">minutes</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="re-full-day" className={fieldLabelCls}>Full day from</label>
              <div className="flex items-center gap-2">
                <input
                  id="re-full-day" type="number" min={0} max={1440} step={15}
                  value={rules.min_full_day_minutes}
                  onChange={(e) => setRules({ ...rules, min_full_day_minutes: Number(e.target.value) })}
                  className={`${inputCls} w-24`}
                />
                <span className="text-xs text-[#64748B]">minutes</span>
              </div>
            </div>
          </div>
          {/* The consequential part: below the half-day floor the day is Absent,
              not Half Day. Spelled out because it is the surprising outcome. */}
          <p className="mt-3 text-xs text-[#64748B]">
            Below {rules.min_half_day_minutes} minutes a day with attendance is marked{' '}
            <span className="font-semibold text-[#0F172A]">Absent</span>, and the employee
            can request regularization. The check-in and check-out times are still kept.
          </p>
          {thresholdOrderInvalid && (
            <p role="alert" className="mt-2 text-xs font-medium text-red-600">
              The half-day minimum must not exceed the full-day minimum.
            </p>
          )}
        </div>
      </PageSection>

      <PageSection title="Regularization">
        <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-4">
          <p className="text-xs text-[#64748B]">
            A regularization is an employee&apos;s request to correct what a past day
            says about their attendance. These settings decide how far back they may
            reach and who has to sign it off.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="re-backdate" className="block text-sm font-medium text-[#0F172A]">
              Allow requests up to
            </label>
            <input
              id="re-backdate" type="number" min={0} max={365} step={1}
              value={rules.regularization_max_backdate_days}
              onChange={(e) => setRules({ ...rules, regularization_max_backdate_days: Number(e.target.value) })}
              className={`${inputCls} w-24`}
            />
            <span className="text-xs text-[#64748B]">days old</span>
          </div>
          <p className="mt-0.5 text-xs text-[#64748B]">
            {rules.regularization_max_backdate_days === 0
              ? 'Employees can only regularize today.'
              : `Employees can regularize today and the previous ${rules.regularization_max_backdate_days} day(s) — on or after ${earliestWorkDate}.`}{' '}
            A date in the future is never accepted.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F1F5F9] pt-3">
            <label htmlFor="re-levels" className="block text-sm font-medium text-[#0F172A]">
              Require
            </label>
            <input
              id="re-levels" type="number" min={1} max={5} step={1}
              value={rules.regularization_approval_levels}
              onChange={(e) => setRules({ ...rules, regularization_approval_levels: Number(e.target.value) })}
              className={`${inputCls} w-24`}
            />
            <span className="text-xs text-[#64748B]">level(s) of approval</span>
          </div>
          {/* The approver chain is materialized when the request is submitted, so
              a change here can never reshuffle something already under review —
              worth saying, because the opposite is the natural assumption. */}
          <p className="mt-0.5 text-xs text-[#64748B]">
            How far up the reporting chain a request travels before it is approved.
            1 = the direct manager only. Applies to requests filed from now on;
            requests already awaiting a decision keep the approvers they started with.
          </p>
        </div>
      </PageSection>

      <PageSection title="Face verification">
        <div className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-1">
          <ToggleRow
            id="re-face-match"
            label="Require face match"
            description="Compare each check-in selfie against the employee's enrolled photo. Employees without a photo are prompted to add one before they can check in."
            checked={rules.require_face_match}
            onChange={(v) => setRules({ ...rules, require_face_match: v })}
          >
            <div className="mt-2.5 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="re-threshold" className={fieldLabelCls}>Match threshold</label>
                <input
                  id="re-threshold" type="number" min={50} max={100} step={1}
                  value={rules.face_match_threshold}
                  onChange={(e) => setRules({ ...rules, face_match_threshold: Number(e.target.value) })}
                  disabled={!rules.require_face_match}
                  className={`${inputCls} w-24`}
                />
                <span className={`text-xs ${rules.require_face_match ? 'text-[#64748B]' : 'text-[#CBD5E1]'}`}>%</span>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="re-face-action" className={fieldLabelCls}>On mismatch</label>
                <select
                  id="re-face-action"
                  value={rules.face_match_action}
                  onChange={(e) => setRules({ ...rules, face_match_action: e.target.value })}
                  disabled={!rules.require_face_match}
                  // w-44: "Flag for review" plus the native chevron; w-28 clipped it.
                  className={`${inputCls} w-44 pr-8`}
                >
                  <option value="flag">Flag for review</option>
                  <option value="block">Block check-in</option>
                </select>
              </div>
            </div>
          </ToggleRow>

          <div className="border-b border-[#F1F5F9] py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="re-cooldown" className="block text-sm font-medium text-[#0F172A]">
                Photo change cooldown
              </label>
              <input
                id="re-cooldown" type="number" min={0} max={365} step={1}
                value={rules.photo_change_cooldown_days}
                onChange={(e) => setRules({ ...rules, photo_change_cooldown_days: Number(e.target.value) })}
                className={`${inputCls} w-24`}
              />
              <span className="text-xs text-[#64748B]">days</span>
            </div>
            <p className="mt-0.5 text-xs text-[#64748B]">
              How long a member must wait before changing their own reference photo. Admins can change it any time from the Team screen.
            </p>
          </div>

          <div className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="re-retention" className="block text-sm font-medium text-[#0F172A]">
                Check-in photo retention
              </label>
              <input
                id="re-retention" type="number" min={1} max={3650} step={1}
                value={rules.image_retention_days}
                onChange={(e) => setRules({ ...rules, image_retention_days: Number(e.target.value) })}
                className={`${inputCls} w-24`}
              />
              <span className="text-xs text-[#64748B]">days</span>
            </div>
            <p className="mt-0.5 text-xs text-[#64748B]">
              Daily check-in/out selfies are deleted by the cleanup job after this many days. The enrolled reference photo is never auto-deleted.
            </p>
          </div>
        </div>
      </PageSection>

      {/* One action for the whole form. Two separate save buttons meant the page
          could not say whether an edit was persisted, and editing both halves
          then pressing one of them silently dropped the other. */}
      <div className="flex items-center justify-end gap-3 border-t border-[#E2E8F0] pt-4">
        {dirty && <span className="text-xs text-[#64748B]">Unsaved changes</span>}
        <Button variant="primary" size="md" onClick={save} disabled={saving || !dirty || thresholdOrderInvalid}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
