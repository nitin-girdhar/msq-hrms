// Employee facts inside Admin -> Team -> Edit. admin-web mounts one of these per tab through
// team-web's `extraTabs` slot, so the account and the HR profile are edited in ONE place and the HRMS
// Employees page stays read-only. Each section loads and saves on its own: a failure in one never
// loses another tab's edits. Server side is hr-service PATCH /hr/employees/:userId (+ personal and
// contacts), which proves hr.employees.manage and refuses your own record.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@platform/ui-kit';
import { hrEmployees } from '../../lib/api/client';
import type { EmployeeProfileView, HrLookupOption } from '../../lib/leave/types';
import {
  BLOOD_GROUPS, GENDER_OPTIONS, MARITAL_OPTIONS, WORK_MODE_OPTIONS,
  type EmergencyContact, type PersonalForm,
} from '../../lib/profile/types';
import { fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';
import ContactsEditor, { type ContactActions } from '../profile/ContactsEditor';

export type EmployeeHrSectionKey = 'employment' | 'org' | 'work' | 'personal';

interface Props {
  section: EmployeeHrSectionKey;
  userId: string;
  /** The person being edited is the signed-in admin: employment facts are read-only, personal goes through My profile. */
  isSelf: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_PERSONAL: PersonalForm = {
  preferred_name: '', date_of_birth: '', gender: '', marital_status: '', blood_group: '',
  nationality: '', personal_email: '', current_address: '', permanent_address: '',
};

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 404;
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={fieldLabelCls}>{label}</label>
      {children}
      {hint && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'border-status-overdue/30 bg-status-overdue-container text-on-status-overdue-container'
    : tone === 'success'
      ? 'border-status-success/30 bg-status-success-container text-on-status-success-container'
      : 'border-outline-variant bg-surface-container-low text-on-surface-variant';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

export default function EmployeeHrSection({ section, userId, isSelf }: Props) {
  if (section === 'personal') return <PersonalSection userId={userId} isSelf={isSelf} />;
  return <ProfileSection section={section} userId={userId} isSelf={isSelf} />;
}

// ── Employment · Org placement · Work & schedule: all fields of hr.employee_profiles ─────────────
function ProfileSection({ section, userId, isSelf }: { section: Exclude<EmployeeHrSectionKey, 'personal'>; userId: string; isSelf: boolean }) {
  const [emp, setEmp] = useState<EmployeeProfileView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [departments, setDepartments] = useState<HrLookupOption[]>([]);
  const [designations, setDesignations] = useState<HrLookupOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [joinOnCreate, setJoinOnCreate] = useState(new Date().toISOString().slice(0, 10));

  // form state, seeded from the loaded profile
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState('');
  const [probation, setProbation] = useState('');
  const [noticeDays, setNoticeDays] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [grade, setGrade] = useState('');
  const [squad, setSquad] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [workMode, setWorkMode] = useState('');
  const [seat, setSeat] = useState('');
  const [weeklyOff, setWeeklyOff] = useState<number[]>([0, 6]);

  const seed = (p: EmployeeProfileView) => {
    setCode(p.employee_code ?? '');
    setJoining(p.date_of_joining ?? '');
    setProbation(p.probation_end_date ?? '');
    setNoticeDays(p.notice_period_days != null ? String(p.notice_period_days) : '');
    setDepartment(p.department_name ?? '');
    setDesignation(p.designation_name ?? '');
    setGrade(p.grade ?? '');
    setSquad(p.squad ?? '');
    setCostCenter(p.cost_center ?? '');
    setWorkMode(p.work_mode ?? '');
    setSeat(p.seat_label ?? '');
    setWeeklyOff(p.weekly_off_pattern ?? [0, 6]);
  };

  const load = useCallback(() => {
    setState('loading');
    hrEmployees.get(userId)
      .then((res) => { setEmp(res.data); seed(res.data); setState('ready'); })
      .catch((err) => { setError(isNotFound(err) ? null : errMsg(err, 'Could not load the HR profile.')); setState(isNotFound(err) ? 'missing' : 'error'); });
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (section !== 'org') return;
    Promise.all([hrEmployees.departments.list(), hrEmployees.designations.list()])
      .then(([d, ds]) => { setDepartments(d.data); setDesignations(ds.data); })
      .catch(() => { /* the selects fall back to the current value only */ });
  }, [section]);

  const createProfile = async () => {
    setBusy(true); setError(null);
    try {
      await hrEmployees.create({ user_id: userId, date_of_joining: joinOnCreate });
      setNotice('HR profile created.');
      load();
    } catch (err) {
      setError(errMsg(err, 'Could not create the HR profile.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError(null); setNotice(null);
    let body: Record<string, unknown> = {};
    if (section === 'employment') {
      if (!joining) { setError('Joining date is required.'); return; }
      const nd = noticeDays.trim() === '' ? null : Number(noticeDays);
      if (nd !== null && (!Number.isInteger(nd) || nd < 0 || nd > 365)) { setError('Notice period is a whole number of days, 0 to 365.'); return; }
      body = { employee_code: code.trim() || undefined, date_of_joining: joining, probation_end_date: probation || null, notice_period_days: nd };
    } else if (section === 'org') {
      body = {
        department_name: department || undefined,
        designation_name: designation || undefined,
        grade: grade.trim() || null,
        squad: squad.trim() || null,
        cost_center: costCenter.trim() || null,
      };
    } else {
      body = { work_mode: workMode || null, seat_label: seat.trim() || null, weekly_off_pattern: weeklyOff };
    }
    setBusy(true);
    try {
      await hrEmployees.update(userId, body);
      setNotice('Saved.');
      load();
    } catch (err) {
      setError(errMsg(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <div className={stateBlockCls}>Loading…</div>;
  if (state === 'error') return <Banner tone="error">{error ?? 'Could not load the HR profile.'}</Banner>;

  if (state === 'missing') {
    return (
      <div className="flex flex-col gap-3">
        <Banner tone="info">
          This member has no HR profile yet, so HRMS leave, attendance and the Employees directory do not list them.
          {isSelf ? ' Ask another HR admin to create yours.' : ' Give a joining date to create it.'}
        </Banner>
        {error && <Banner tone="error">{error}</Banner>}
        {!isSelf && (
          <div className="flex flex-wrap items-end gap-3">
            <Field id="hr-join-new" label="Joining date *">
              <input id="hr-join-new" type="date" value={joinOnCreate} onChange={(e) => setJoinOnCreate(e.target.value)} className={fieldInputCls} disabled={busy} />
            </Field>
            <Button variant="primary" onClick={() => void createProfile()} disabled={busy || !joinOnCreate}>{busy ? 'Creating…' : 'Create HR profile'}</Button>
          </div>
        )}
      </div>
    );
  }

  const lock = busy || isSelf;
  const inactive = emp && emp.is_active === false;
  const withCurrent = (opts: HrLookupOption[], cur: string) =>
    cur && !opts.some((o) => o.name === cur) ? [{ id: '__cur', name: cur }, ...opts] : opts;

  return (
    <div className="flex flex-col gap-4">
      {isSelf && <Banner tone="info">This is your own record, so employment details are read-only here. Another HR admin can change them.</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="success">{notice}</Banner>}

      {section === 'employment' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="hr-code" label="Employee code"><input id="hr-code" value={code} onChange={(e) => setCode(e.target.value)} className={fieldInputCls} disabled={lock} /></Field>
          <Field id="hr-join" label="Joining date *"><input id="hr-join" type="date" value={joining} onChange={(e) => setJoining(e.target.value)} className={fieldInputCls} disabled={lock} /></Field>
          <Field id="hr-type" label="Employment type" hint="Set by the platform administrator.">
            <input id="hr-type" value={emp?.employment_type_name ?? '—'} className={fieldInputCls} disabled readOnly />
          </Field>
          <Field id="hr-prob" label="Probation ends"><input id="hr-prob" type="date" value={probation} onChange={(e) => setProbation(e.target.value)} className={fieldInputCls} disabled={lock} /></Field>
          <Field id="hr-notice" label="Notice period (days)"><input id="hr-notice" inputMode="numeric" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} className={fieldInputCls} disabled={lock} /></Field>
          <Field id="hr-exit" label="Last working day" hint={inactive ? `Set when the account was deactivated${emp?.exit_reason ? ` · ${emp.exit_reason}` : ''}.` : 'Filled in when the member is deactivated from the Account tab.'}>
            <input id="hr-exit" type="date" value={emp?.date_of_exit ?? ''} className={fieldInputCls} disabled readOnly />
          </Field>
        </div>
      )}

      {section === 'org' && (
        <>
          {emp?.designation_needs_review && (
            <Banner tone="info">This person moved branches and their designation does not exist in the new branch, so it was cleared. Pick one below.</Banner>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="hr-dept" label="Department">
              <select id="hr-dept" value={department} onChange={(e) => setDepartment(e.target.value)} className={fieldInputCls} disabled={lock}>
                <option value="">— not set —</option>
                {withCurrent(departments, department).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field id="hr-desig" label="Designation" hint="This branch's designations.">
              <select id="hr-desig" value={designation} onChange={(e) => setDesignation(e.target.value)} className={fieldInputCls} disabled={lock}>
                <option value="">— not set —</option>
                {withCurrent(designations, designation).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field id="hr-grade" label="Grade / level"><input id="hr-grade" value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={40} placeholder="e.g. L4" className={fieldInputCls} disabled={lock} /></Field>
            <Field id="hr-squad" label="Squad"><input id="hr-squad" value={squad} onChange={(e) => setSquad(e.target.value)} maxLength={100} className={fieldInputCls} disabled={lock} /></Field>
            <Field id="hr-cc" label="Cost centre"><input id="hr-cc" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} maxLength={60} className={fieldInputCls} disabled={lock} /></Field>
          </div>
          {(emp?.other_branches?.length ?? 0) > 0 && (
            <p className="text-xs text-on-surface-variant">
              <span className="font-semibold text-on-surface">Also works in:</span> {emp!.other_branches!.map((b) => b.name).join(', ')}. Leave, shifts and attendance stay with the home branch.
            </p>
          )}
        </>
      )}

      {section === 'work' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="hr-mode" label="Work mode">
              <select id="hr-mode" value={workMode} onChange={(e) => setWorkMode(e.target.value)} className={fieldInputCls} disabled={lock}>
                <option value="">—</option>
                {WORK_MODE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field id="hr-seat" label="Seat"><input id="hr-seat" value={seat} onChange={(e) => setSeat(e.target.value)} maxLength={60} placeholder="e.g. Floor 4, Desk 412" className={fieldInputCls} disabled={lock} /></Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelCls}>Weekly off</span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((w, d) => (
                <label key={w} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${weeklyOff.includes(d) ? 'border-primary bg-primary-fixed text-primary' : 'border-outline-variant text-on-surface-variant'}`}>
                  <input type="checkbox" checked={weeklyOff.includes(d)} disabled={lock}
                    onChange={() => setWeeklyOff((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))} className="h-3.5 w-3.5" />
                  {w}
                </label>
              ))}
            </div>
          </div>
          <Banner tone="info">
            Today&apos;s shift: {emp?.on_leave_today ? 'on leave' : emp?.shift_name ? `${emp.shift_name} ${emp.shift_start}–${emp.shift_end}` : 'no shift assigned'}. Shifts are assigned under Attendance → Shifts.
          </Banner>
        </>
      )}

      {!isSelf && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </div>
  );
}

// ── Personal: another person's details and emergency contacts ────────────────────────────────────
function PersonalSection({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const [form, setForm] = useState<PersonalForm>(EMPTY_PERSONAL);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setState('loading');
    hrEmployees.personal.get(userId)
      .then((res) => {
        const p = res.data.personal;
        setForm(p ? {
          preferred_name: p.preferred_name ?? '', date_of_birth: p.date_of_birth ?? '', gender: p.gender ?? '',
          marital_status: p.marital_status ?? '', blood_group: p.blood_group ?? '', nationality: p.nationality ?? '',
          personal_email: p.personal_email ?? '', current_address: p.current_address ?? '', permanent_address: p.permanent_address ?? '',
        } : EMPTY_PERSONAL);
        setContacts(res.data.contacts);
        setState('ready');
      })
      .catch((err) => { setError(isNotFound(err) ? null : errMsg(err, 'Could not load personal details.')); setState(isNotFound(err) ? 'missing' : 'error'); });
  }, [userId]);

  useEffect(() => { if (!isSelf) load(); }, [load, isSelf]);

  const set = (k: keyof PersonalForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await hrEmployees.personal.save(userId, form);
      setNotice('Personal details saved.');
    } catch (err) {
      setError(errMsg(err, 'Could not save personal details.'));
    } finally {
      setBusy(false);
    }
  };

  const actions: ContactActions = {
    add: (b) => hrEmployees.contacts.add(userId, b),
    update: (id, b) => hrEmployees.contacts.update(userId, id, b),
    remove: (id) => hrEmployees.contacts.remove(userId, id),
  };

  if (isSelf) return <Banner tone="info">Your own personal details and emergency contacts are edited under <strong>My profile</strong>.</Banner>;
  if (state === 'loading') return <div className={stateBlockCls}>Loading…</div>;
  if (state === 'missing') return <Banner tone="info">This member has no HR profile yet. Create it on the Employment tab first.</Banner>;
  if (state === 'error') return <Banner tone="error">{error ?? 'Could not load personal details.'}</Banner>;

  return (
    <div className="flex flex-col gap-4">
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="success">{notice}</Banner>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="hp-preferred" label="Preferred name"><input id="hp-preferred" value={form.preferred_name} onChange={set('preferred_name')} maxLength={100} className={fieldInputCls} disabled={busy} /></Field>
        <Field id="hp-dob" label="Date of birth"><input id="hp-dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} className={fieldInputCls} disabled={busy} /></Field>
        <Field id="hp-gender" label="Gender">
          <select id="hp-gender" value={form.gender} onChange={set('gender')} className={fieldInputCls} disabled={busy}>
            <option value="">—</option>
            {GENDER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field id="hp-marital" label="Marital status">
          <select id="hp-marital" value={form.marital_status} onChange={set('marital_status')} className={fieldInputCls} disabled={busy}>
            <option value="">—</option>
            {MARITAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field id="hp-blood" label="Blood group">
          <select id="hp-blood" value={form.blood_group} onChange={set('blood_group')} className={fieldInputCls} disabled={busy}>
            <option value="">—</option>
            {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field id="hp-nat" label="Nationality"><input id="hp-nat" value={form.nationality} onChange={set('nationality')} maxLength={100} className={fieldInputCls} disabled={busy} /></Field>
        <div className="sm:col-span-2">
          <Field id="hp-email" label="Personal email"><input id="hp-email" type="email" value={form.personal_email} onChange={set('personal_email')} maxLength={254} className={fieldInputCls} disabled={busy} /></Field>
        </div>
        <Field id="hp-cur" label="Current address"><textarea id="hp-cur" value={form.current_address} onChange={set('current_address')} maxLength={500} rows={2} className={`${fieldInputCls} h-auto py-2`} disabled={busy} /></Field>
        <Field id="hp-perm" label="Permanent address"><textarea id="hp-perm" value={form.permanent_address} onChange={set('permanent_address')} maxLength={500} rows={2} className={`${fieldInputCls} h-auto py-2`} disabled={busy} /></Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save personal details'}</Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className={fieldLabelCls}>Emergency contacts</span>
        <ContactsEditor contacts={contacts} actions={actions} onChanged={(m) => { setNotice(m); load(); }} onError={setError} />
      </div>
      <Banner tone="info">Bank, PAN and other statutory details stay in Employee 360 → Statutory, where changes go through the approval flow.</Banner>
    </div>
  );
}
