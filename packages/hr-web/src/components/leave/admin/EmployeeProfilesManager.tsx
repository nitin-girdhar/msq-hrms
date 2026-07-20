'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { hrEmployees } from '../../../lib/api/client';
import type { EmployeeProfileView, HrLookupOption } from '../../../lib/leave/types';

interface Props {
  onNotice: (msg: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function EmployeeProfilesManager({ onNotice }: Props) {
  const [profiles, setProfiles] = useState<EmployeeProfileView[]>([]);
  const [departments, setDepartments] = useState<HrLookupOption[]>([]);
  const [designations, setDesignations] = useState<HrLookupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmployeeProfileView | null>(null);

  const loadLookups = useCallback(() => {
    Promise.all([hrEmployees.departments.list(), hrEmployees.designations.list()])
      .then(([d, ds]) => { setDepartments(d.data); setDesignations(ds.data); })
      .catch(() => { /* lookups optional */ });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    hrEmployees
      .list()
      .then((res) => setProfiles(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load employee profiles.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); loadLookups(); }, [load, loadLookups]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#64748B]">Employment facts used by leave &amp; attendance — joining date, department, designation and weekly-off pattern.</p>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-[#94A3B8]">Loading…</div>
      ) : profiles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">No employee profiles yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Weekly off</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.user_id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#0F172A]">{p.full_name}</p>
                    <p className="text-[11px] text-[#94A3B8]">{p.email}</p>
                  </td>
                  <td className="px-4 py-3 text-[#475569]">{p.employee_code ?? '—'}</td>
                  <td className="px-4 py-3 text-[#475569]">{p.date_of_joining ?? '—'}</td>
                  <td className="px-4 py-3 text-[#475569]">{p.department_name ?? '—'}</td>
                  <td className="px-4 py-3 text-[#475569]">{p.designation_name ?? '—'}</td>
                  <td className="px-4 py-3 text-[11px] text-[#475569]">
                    {(p.weekly_off_pattern ?? []).map((d) => WEEKDAYS[d]).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => setEditing(p)} className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:border-[#0b6cbf] hover:text-[#0b6cbf]">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EmployeeEditModal
          profile={editing}
          departments={departments}
          designations={designations}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { onNotice(msg); load(); loadLookups(); }}
        />
      )}
    </div>
  );
}

interface EditProps {
  profile: EmployeeProfileView;
  departments: HrLookupOption[];
  designations: HrLookupOption[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}

function EmployeeEditModal({ profile, departments, designations, onClose, onSaved }: EditProps) {
  const [joining, setJoining] = useState(profile.date_of_joining ?? '');
  const [code, setCode] = useState(profile.employee_code ?? '');
  const [department, setDepartment] = useState(profile.department_name ?? '');
  const [designation, setDesignation] = useState(profile.designation_name ?? '');
  const [weeklyOff, setWeeklyOff] = useState<number[]>(profile.weekly_off_pattern ?? [0, 6]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) => {
    setWeeklyOff((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const save = async () => {
    setError(null);
    if (!joining) { setError('Joining date is required.'); return; }
    setSubmitting(true);
    try {
      await hrEmployees.update(profile.user_id, {
        date_of_joining: joining,
        employee_code: code.trim() || undefined,
        department_name: department.trim() || undefined,
        designation_name: designation.trim() || undefined,
        weekly_off_pattern: weeklyOff,
      });
      onSaved('Employee profile updated.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20';
  const labelCls = 'text-xs font-semibold text-[#0F172A]';

  return (
    <Modal open onClose={onClose} title={`Edit — ${profile.full_name}`} locked={submitting} maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-join" className={labelCls}>Joining date *</label>
            <input id="ee-join" type="date" value={joining} onChange={(e) => setJoining(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-code" className={labelCls}>Employee code</label>
            <input id="ee-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-dept" className={labelCls}>Department</label>
            <input id="ee-dept" list="ee-dept-list" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={submitting} className={inputCls} />
            <datalist id="ee-dept-list">{departments.map((d) => <option key={d.id} value={d.name} />)}</datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ee-desig" className={labelCls}>Designation</label>
            <input id="ee-desig" list="ee-desig-list" value={designation} onChange={(e) => setDesignation(e.target.value)} disabled={submitting} className={inputCls} />
            <datalist id="ee-desig-list">{designations.map((d) => <option key={d.id} value={d.name} />)}</datalist>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Weekly off</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((w, d) => (
              <label key={w} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${weeklyOff.includes(d) ? 'border-[#0b6cbf] bg-[#EFF6FF] text-[#0b6cbf]' : 'border-[#E2E8F0] text-[#475569]'}`}>
                <input type="checkbox" checked={weeklyOff.includes(d)} onChange={() => toggleDay(d)} disabled={submitting} className="h-3.5 w-3.5" />
                {w}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60">Cancel</button>
          <button type="button" onClick={save} disabled={submitting} className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:opacity-60">
            {submitting ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
