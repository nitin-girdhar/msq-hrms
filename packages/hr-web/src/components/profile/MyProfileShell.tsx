'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader } from '@platform/ui-kit';
import { profile } from '../../lib/api/client';
import {
  BLOOD_GROUPS,
  GENDER_OPTIONS,
  MARITAL_OPTIONS,
  type ChainLink,
  type EmergencyContact,
  type EmployeeHeader,
  type PersonalDetails,
  type PersonalForm,
} from '../../lib/profile/types';
import { profileCompleteness } from '../../lib/profile/completeness';
import { formatDay } from '../../lib/attendance/format';
import { Avatar, Card, CompletenessRing, LeaveBalanceCard, ReportingChain } from './ProfileParts';
import { fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';
import { can, CAPABILITY } from '@platform/rbac';
import ContactsEditor from './ContactsEditor';
import { MyAssetsList } from './AssetsPanel';
import { MyStatutorySection } from './StatutoryPanel';
import { buildChangePasswordUrl } from '@platform/ui-kit';

interface Props {
  actor: SessionUser;
}

type Tab = 'personal' | 'statutory' | 'contacts' | 'security';
const TABS: Array<[Tab, string]> = [['personal', 'Personal & contact'], ['statutory', 'Statutory & banking'], ['contacts', 'Emergency contacts'], ['security', 'Security']];

const EMPTY: PersonalForm = {
  preferred_name: '', date_of_birth: '', gender: '', marital_status: '', blood_group: '',
  nationality: '', personal_email: '', current_address: '', permanent_address: '',
};

const toForm = (p: PersonalDetails | null): PersonalForm => ({
  preferred_name: p?.preferred_name ?? '',
  date_of_birth: p?.date_of_birth ?? '',
  gender: p?.gender ?? '',
  marital_status: p?.marital_status ?? '',
  blood_group: p?.blood_group ?? '',
  nationality: p?.nationality ?? '',
  personal_email: p?.personal_email ?? '',
  current_address: p?.current_address ?? '',
  permanent_address: p?.permanent_address ?? '',
});

/**
 * "My profile": the employee's own personal details and emergency contacts. Work
 * details (department, designation, manager, joining date) are HR's to change and
 * are shown read-only up top. Bank and statutory identifiers are not here — see the
 * 1.60.0 notes: they wait on an encryption-key decision.
 */
export default function MyProfileShell({ actor }: Props) {
  const [form, setForm] = useState<PersonalForm>(EMPTY);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [personal, setPersonal] = useState<PersonalDetails | null>(null);
  const [header, setHeader] = useState<EmployeeHeader | null>(null);
  const [balances, setBalances] = useState<Array<{ leave_type_label: string; balance: number }>>([]);
  const [chain, setChain] = useState<ChainLink[]>([]);
  const [tab, setTab] = useState<Tab>('personal');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    profile
      .mine()
      .then((res) => {
        setForm(toForm(res.data.personal)); setPersonal(res.data.personal); setContacts(res.data.contacts);
        setHeader(res.data.header); setBalances(res.data.balances); setChain(res.data.chain);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load your profile.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key: keyof PersonalForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await profile.savePersonal(form);
      setNotice('Your details were saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details.');
    } finally {
      setSaving(false);
    }
  };

  const name = header?.full_name || actor.name || actor.email;
  const done = profileCompleteness(header, personal, contacts);
  const workLine = [header?.designation_name, header?.department_name].filter(Boolean).join(' — ');

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader title="My profile" info="Your details, contacts and account" />
      <PageBody dense>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {loading ? (
          <div className={stateBlockCls}>Loading…</div>
        ) : (
          <>
            <section className="grid gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5 lg:grid-cols-[1fr_auto]">
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row">
                <Avatar name={name} userId={actor.id} />
                <div className="min-w-0 space-y-1.5">
                  <h2 className="truncate text-headline-md font-bold text-on-surface">{name}</h2>
                  {workLine && <p className="text-sm font-medium text-primary">{workLine}</p>}
                  <p className="text-sm text-on-surface-variant">{actor.email}{header?.mobile ? ` · ${header.mobile}` : ''}</p>
                  <p className="text-xs text-on-surface-variant">
                    {[header?.employee_code, header?.employment_type_label, header?.date_of_joining ? `Joined ${formatDay(header.date_of_joining)}` : null].filter(Boolean).join(' · ') || 'Work details are set by HR.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 lg:w-72">
                <CompletenessRing value={done} />
                {can(actor, CAPABILITY.HR_EMPLOYEES_PROFILE_EDIT) && (
                  <Button variant="primary" onClick={() => setTab('statutory')}>Request a profile update</Button>
                )}
              </div>
            </section>

            <div className="flex gap-1 overflow-x-auto border-b border-outline-variant" role="tablist">
              {TABS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                  className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${tab === key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {tab === 'personal' && (
                  <Card title="Legal & personal details" subtitle="You can edit these yourself">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field id="pp-preferred" label="Preferred name"><input id="pp-preferred" value={form.preferred_name} onChange={set('preferred_name')} maxLength={100} className={fieldInputCls} /></Field>
                      <Field id="pp-dob" label="Date of birth"><input id="pp-dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} className={fieldInputCls} /></Field>
                      <Field id="pp-gender" label="Gender">
                        <select id="pp-gender" value={form.gender} onChange={set('gender')} className={fieldInputCls}>
                          <option value="">—</option>
                          {GENDER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </Field>
                      <Field id="pp-marital" label="Marital status">
                        <select id="pp-marital" value={form.marital_status} onChange={set('marital_status')} className={fieldInputCls}>
                          <option value="">—</option>
                          {MARITAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </Field>
                      <Field id="pp-blood" label="Blood group">
                        <select id="pp-blood" value={form.blood_group} onChange={set('blood_group')} className={fieldInputCls}>
                          <option value="">—</option>
                          {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </Field>
                      <Field id="pp-nationality" label="Nationality"><input id="pp-nationality" value={form.nationality} onChange={set('nationality')} maxLength={100} className={fieldInputCls} /></Field>
                      <div className="sm:col-span-2">
                        <Field id="pp-email" label="Personal email"><input id="pp-email" type="email" value={form.personal_email} onChange={set('personal_email')} maxLength={254} className={fieldInputCls} /></Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field id="pp-current" label="Current address"><textarea id="pp-current" value={form.current_address} onChange={set('current_address')} maxLength={500} rows={2} className={`${fieldInputCls} h-auto py-2`} /></Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field id="pp-permanent" label="Permanent address"><textarea id="pp-permanent" value={form.permanent_address} onChange={set('permanent_address')} maxLength={500} rows={2} className={`${fieldInputCls} h-auto py-2`} /></Field>
                      </div>
                      <div className="flex justify-end sm:col-span-2">
                        <Button variant="primary" size="md" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save details'}</Button>
                      </div>
                    </div>
                  </Card>
                )}

                {tab === 'statutory' && (
                  <Card title="Statutory compliance & payroll" subtitle="Changes are reviewed by HR before they apply">
                    <MyStatutorySection onError={setError} onNotice={setNotice} />
                  </Card>
                )}

                {tab === 'contacts' && (
                  <Card title="Emergency contacts" subtitle="Who we should call if something happens">
                    <ContactsEditor
                      contacts={contacts}
                      onChanged={(message) => { setNotice(message); setError(null); load(); }}
                      onError={setError}
                    />
                  </Card>
                )}

                {tab === 'security' && (
                  <Card title="Security" subtitle="Your sign-in">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/60 bg-surface-container-low px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-on-surface">Password</p>
                        <p className="text-xs text-on-surface-variant">Changing it signs you out of every other device.</p>
                      </div>
                      <a href={buildChangePasswordUrl()} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:border-primary hover:text-primary">Change password</a>
                    </div>
                  </Card>
                )}
              </div>

              <div className="space-y-4">
                <Card title="Organizational line" subtitle={header?.manager_name ? `Reports to ${header.manager_name}` : undefined}>
                  <ReportingChain self={name} chain={chain} />
                </Card>
                <LeaveBalanceCard balances={balances} />
                <Card title="Emergency responders" action={<button type="button" onClick={() => setTab('contacts')} className="text-xs font-semibold text-primary hover:underline">{contacts.length ? 'Manage' : 'Add'}</button>}>
                  {contacts.length === 0 ? (
                    <p className="text-sm text-on-surface-variant">None yet. Add someone we can reach.</p>
                  ) : (
                    <ul className="space-y-2">
                      {contacts.map((c) => (
                        <li key={c.id} className="rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2">
                          <p className="text-sm font-semibold text-on-surface">{c.name}{c.is_primary && <span className="ml-2 rounded-full bg-primary-fixed px-2 py-0.5 text-label-sm font-semibold text-on-primary-fixed">Primary</span>}</p>
                          <p className="text-xs text-on-surface-variant">{c.relation} · {c.phone}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                {can(actor, CAPABILITY.HR_EMPLOYEES_ASSETS_VIEW) && (
                  <Card title="My equipment">
                    <MyAssetsList />
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </PageBody>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={fieldLabelCls}>{label}</label>
      {children}
    </div>
  );
}
