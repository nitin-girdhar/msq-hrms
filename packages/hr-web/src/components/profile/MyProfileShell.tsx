'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Alert, Button, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { profile } from '../../lib/api/client';
import {
  BLOOD_GROUPS,
  GENDER_OPTIONS,
  MARITAL_OPTIONS,
  type EmergencyContact,
  type PersonalDetails,
  type PersonalForm,
} from '../../lib/profile/types';
import { fieldInputCls, fieldLabelCls, stateBlockCls } from '../../lib/ui';
import { can, CAPABILITY } from '@platform/rbac';
import ContactsEditor from './ContactsEditor';
import { MyAssetsList } from './AssetsPanel';

interface Props {
  actor: SessionUser;
}

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    profile
      .mine()
      .then((res) => { setForm(toForm(res.data.personal)); setContacts(res.data.contacts); })
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

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader title="My profile" subtitle={`Your personal details and emergency contacts, ${actor.name || actor.email}.`} />
      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {loading ? (
          <div className={stateBlockCls}>Loading…</div>
        ) : (
          <>
            <PageSection title="Personal details">
              <div className="grid gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:grid-cols-2 sm:p-5">
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
            </PageSection>

            <PageSection title="Emergency contacts">
              <ContactsEditor
                contacts={contacts}
                onChanged={(message) => { setNotice(message); setError(null); load(); }}
                onError={setError}
              />
            </PageSection>
            {can(actor, CAPABILITY.HR_EMPLOYEES_ASSETS_VIEW) && (
              <PageSection title="My equipment">
                <MyAssetsList />
              </PageSection>
            )}
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
