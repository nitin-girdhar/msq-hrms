'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, Button, PageBody, PageHeader, PageSection, SpeechInputButton, appendDictation } from '@platform/ui-kit';
import { employee360 } from '../../lib/api/client';
import {
  GENDER_OPTIONS,
  MARITAL_OPTIONS,
  NOTE_KIND_OPTIONS,
  WORK_MODE_OPTIONS,
  optionLabel,
  type Employee360,
} from '../../lib/profile/types';
import { formatDay, formatDateTime } from '../../lib/attendance/format';
import { emptyBlockCls, fieldInputCls, stateBlockCls } from '../../lib/ui';
import AssetsPanel from './AssetsPanel';
import { EmployeeDocumentsPanel } from '../documents/DocumentsPanels';
import StatutoryPanel from './StatutoryPanel';
import { AttendanceSnapshot, AttendanceTab, AuditTab } from './Employee360Tabs';
import { Avatar, Card, CompletenessRing, LeaveBalanceCard, ReportingChain, Tile } from './ProfileParts';
import { profileCompleteness } from '../../lib/profile/completeness';

interface Props {
  actor: SessionUser;
  userId: string;
}

type Tab = 'overview' | 'attendance' | 'leave' | 'statutory' | 'assets' | 'documents' | 'notes' | 'audit';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function tenure(joined: string | null): string {
  if (!joined) return '—';
  const start = new Date(`${joined}T00:00:00Z`);
  const now = new Date();
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  if (months < 0) return 'Not started';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || 'Under a month';
}

/**
 * Employee 360 (HR): one page for a person — job details, personal details,
 * emergency contacts, leave balances and the HR timeline. The server decides what
 * this caller may see (the route needs hr.employees.profile360.view; HR notes are
 * returned only with hr.employees.notes.manage), so the page just renders what came
 * back. Statutory/bank details and documents are not part of this release.
 */
export default function Employee360Shell({ actor, userId }: Props) {
  const [data, setData] = useState<Employee360 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const canNotes = can(actor, CAPABILITY.HR_EMPLOYEES_NOTES_MANAGE);
  const canAssets = can(actor, CAPABILITY.HR_EMPLOYEES_ASSETS_MANAGE);
  const canDocuments = can(actor, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE);
  const canStatutory = can(actor, CAPABILITY.HR_EMPLOYEES_STATUTORY_MANAGE);
  const canStatutoryView = can(actor, CAPABILITY.HR_EMPLOYEES_STATUTORY_VIEW);

  const load = useCallback(() => {
    employee360
      .get(userId)
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load this profile.'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Everyone who can open a profile sees Overview / Attendance / Leave; Statutory & bank (masked) needs
  // statutory.view, and the rest need their own capability.
  const tabs: Array<[Tab, string]> = [['overview', 'Overview'], ['attendance', 'Attendance'], ['leave', 'Leave']];
  if (canStatutoryView) tabs.push(['statutory', 'Statutory & bank']);
  if (canAssets) tabs.push(['assets', 'Assets']);
  if (canDocuments) tabs.push(['documents', 'Documents']);
  if (canNotes) tabs.push(['notes', 'HR notes'], ['audit', 'Audit trail']);

  if (loading) return <div className="flex w-full flex-1 flex-col"><PageHeader title="Employee" /><PageBody><div className={stateBlockCls}>Loading…</div></PageBody></div>;
  if (!data) {
    return (
      <div className="flex w-full flex-1 flex-col">
        <PageHeader title="Employee" />
        <PageBody>
          <Alert tone="error">{error ?? 'Profile not found.'}</Alert>
          <Link href="/employees" className="text-sm font-semibold text-primary hover:underline">← Back to employees</Link>
        </PageBody>
      </div>
    );
  }

  const h = data.header;
  const done = profileCompleteness(h, data.personal, data.contacts);
  const weeklyOff = (h.weekly_off_pattern ?? []).map((d) => WEEKDAYS[d]).join(', ');

  return (
    <div className="flex w-full flex-1 flex-col">
      <PageHeader title={h.full_name} subtitle={[h.designation_name, h.department_name].filter(Boolean).join(' · ') || h.email} />
      <PageBody>
        <Link href="/employees" className="text-xs font-semibold text-primary hover:underline">← Employees</Link>

        <section className="grid gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5 lg:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row">
            <Avatar name={h.full_name} userId={h.user_id} />
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-headline-md font-bold text-on-surface">{h.full_name}</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-label-sm font-semibold ${h.is_active ? 'bg-status-success-container text-on-status-success-container' : 'bg-status-overdue-container text-on-status-overdue-container'}`}>
                  {h.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm font-medium text-primary">{[h.designation_name, h.department_name].filter(Boolean).join(' — ') || h.role_name}</p>
              <div className="flex flex-wrap gap-2">
                <Chip>{h.employee_code ?? 'No employee code'}</Chip>
                <Chip>{h.date_of_joining ? `Joined ${formatDay(h.date_of_joining)} (${tenure(h.date_of_joining)})` : 'Joining date not set'}</Chip>
                {h.employment_type_label && <Chip>{h.employment_type_label}</Chip>}
                {h.grade && <Chip>{h.grade}</Chip>}
                {h.work_mode && <Chip>{optionLabel(WORK_MODE_OPTIONS, h.work_mode)}</Chip>}
                {weeklyOff && <Chip>Weekly off {weeklyOff}</Chip>}
              </div>
              <p className="text-sm text-on-surface-variant">{h.email}{h.mobile ? ` · ${h.mobile}` : ''}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:w-72">
            <div className="rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2.5">
              <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Reports to</p>
              <p className="text-sm font-semibold text-on-surface">{h.manager_name ?? 'No reporting manager'}</p>
              {data.chain[0]?.designation_name && <p className="text-label-sm text-outline">{data.chain[0].designation_name}</p>}
            </div>
            <CompletenessRing value={done} />
          </div>
        </section>

        <div className="flex gap-1 overflow-x-auto border-b border-outline-variant" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                tab === key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card title="Job & organizational hierarchy" subtitle="Where this person sits and who they report to">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Tile label="Department" value={h.department_name} />
                  <Tile label="Designation" value={h.designation_name} />
                  <Tile label="Employment type" value={h.employment_type_label} />
                  <Tile label="Probation ends" value={h.probation_end_date ? formatDay(h.probation_end_date) : null} />
                  <Tile label="Last working day" value={h.date_of_exit ? formatDay(h.date_of_exit) : null} />
                  <Tile label="Weekly off" value={weeklyOff || null} />
                  <Tile label="Grade / level" value={h.grade} />
                  <Tile label="Squad" value={h.squad} />
                  <Tile label="Cost centre" value={h.cost_center} />
                  <Tile label="Notice period" value={h.notice_period_days != null ? `${h.notice_period_days} days` : null} />
                  <Tile label="Work mode" value={h.work_mode ? optionLabel(WORK_MODE_OPTIONS, h.work_mode) : null} />
                  <Tile label="Seat" value={h.seat_label} />
                </div>
                <div className="mt-4">
                  <p className="mb-2 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Direct reporting chain</p>
                  <ReportingChain self={h.full_name} chain={data.chain} />
                </div>
              </Card>

              <Card title="This month's attendance" subtitle="Counted from the recorded days">
                <AttendanceSnapshot userId={userId} onOpen={() => setTab('attendance')} />
              </Card>
            </div>

            <div className="space-y-4">
              <LeaveBalanceCard balances={data.balances} />

              <Card title="Personal & contact details" subtitle="Confidential identity record">
                {data.personal ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Tile label="Date of birth" value={data.personal.date_of_birth ? formatDay(data.personal.date_of_birth) : null} />
                      <Tile label="Gender · blood" value={[data.personal.gender ? optionLabel(GENDER_OPTIONS, data.personal.gender) : null, data.personal.blood_group].filter(Boolean).join(' · ') || null} />
                      <Tile label="Marital status" value={data.personal.marital_status ? optionLabel(MARITAL_OPTIONS, data.personal.marital_status) : null} />
                      <Tile label="Nationality" value={data.personal.nationality} />
                    </div>
                    <Tile label="Personal email" value={data.personal.personal_email} />
                    <Tile label="Current address" value={data.personal.current_address} />
                    <Tile label="Permanent address" value={data.personal.permanent_address} />
                  </div>
                ) : (
                  <p className={emptyBlockCls}>This person has not filled in their personal details yet.</p>
                )}
              </Card>

              <Card title="Emergency contacts">
                {data.contacts.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">No emergency contacts on file.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.contacts.map((c) => (
                      <li key={c.id} className="rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2">
                        <p className="text-sm font-semibold text-on-surface">
                          {c.name}
                          {c.is_primary && <span className="ml-2 rounded-full bg-primary-fixed px-2 py-0.5 text-label-sm font-semibold text-on-primary-fixed">Primary</span>}
                        </p>
                        <p className="text-xs text-on-surface-variant">{c.relation} · {c.phone}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}

        {tab === 'leave' && (
          <PageSection title="Leave balances">
            {data.balances.length === 0 ? (
              <p className={emptyBlockCls}>No leave balances yet.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {data.balances.map((b) => (
                  <li key={b.leave_type_label} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
                    <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{b.leave_type_label}</p>
                    <p className="mt-1 font-mono text-headline-md font-bold tabular-nums text-on-surface">{b.balance}</p>
                    <p className="text-label-sm text-on-surface-variant">days available</p>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>
        )}

        {tab === 'attendance' && (
          <PageSection title="Attendance">
            <AttendanceTab userId={userId} onError={setError} />
          </PageSection>
        )}

        {tab === 'statutory' && (
          <PageSection title="Statutory and bank details">
            <StatutoryPanel userId={userId} canManage={canStatutory} onError={setError} />
          </PageSection>
        )}

        {tab === 'audit' && canNotes && (
          <PageSection title="Audit trail">
            <AuditTab userId={userId} onError={setError} />
          </PageSection>
        )}

        {tab === 'assets' && canAssets && (
          <PageSection title="Equipment">
            <AssetsPanel userId={userId} onError={setError} />
          </PageSection>
        )}

        {tab === 'documents' && canDocuments && (
          <PageSection title="Documents">
            <EmployeeDocumentsPanel userId={userId} onError={setError} />
          </PageSection>
        )}

        {tab === 'notes' && canNotes && <NotesPanel userId={userId} notes={data.notes} onAdded={load} />}
      </PageBody>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-0.5 text-label-sm font-medium text-on-surface-variant">{children}</span>;
}

function Facts({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  return (
    <dl className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
          <dt className="shrink-0 text-on-surface-variant">{label}</dt>
          <dd className="min-w-0 text-right font-medium text-on-surface">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function NotesPanel({ userId, notes, onAdded }: { userId: string; notes: Employee360['notes']; onAdded: () => void }) {
  const [kind, setKind] = useState('note');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    if (!body.trim()) { setError('A note cannot be empty.'); return; }
    setBusy(true);
    try {
      await employee360.addNote(userId, { kind, body: body.trim() });
      setBody('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the note.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageSection title="Add a note">
        <div className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
          {error && <div role="alert" className="rounded-lg border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>}
          <div className="flex items-center justify-between gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Note type" className={`${fieldInputCls} w-44`} disabled={busy}>
              {NOTE_KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <SpeechInputButton onText={(t) => setBody((p) => appendDictation(p, t, 2000))} disabled={busy} />
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} placeholder="Visible only to people who can manage HR notes." aria-label="Note" className={`${fieldInputCls} h-auto w-full py-2`} disabled={busy} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add note'}</Button>
          </div>
        </div>
      </PageSection>

      <PageSection title="Timeline">
        {notes.length === 0 ? (
          <p className={emptyBlockCls}>No HR notes yet.</p>
        ) : (
          <ol className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-surface-container px-2 py-0.5 text-label-sm font-semibold text-on-surface-variant">{optionLabel(NOTE_KIND_OPTIONS, n.kind)}</span>
                  <span className="text-label-sm text-outline">{n.author_name ?? 'Unknown'} · {formatDateTime(n.created_at)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-on-surface">{n.body}</p>
              </li>
            ))}
          </ol>
        )}
      </PageSection>
    </div>
  );
}
