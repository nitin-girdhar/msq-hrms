'use client';

import { Modal } from '@platform/ui-kit';
import type { AttendanceDayRow } from '../../lib/attendance/types';
import { formatClockTime, formatWorkedMinutes, formatDay } from '../../lib/attendance/format';

interface Props {
  date: string | null;
  row: AttendanceDayRow | undefined;
  onClose: () => void;
  onRequestRegularization: (date: string) => void;
}

const REGULARIZABLE = new Set(['absent', 'not_marked', 'half_day']);

export default function DayDetailPopover({ date, row, onClose, onRequestRegularization }: Props) {
  if (!date) return null;

  const canRegularize = !row || REGULARIZABLE.has(row.status_name);

  return (
    <Modal open onClose={onClose} title={formatDay(date)} maxWidth="max-w-sm">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm">
          <Row label="Status" value={row?.status_label ?? 'Not marked'} />
          <Row label="Worked" value={formatWorkedMinutes(row?.worked_minutes ?? null)} />
          <Row label="In" value={formatClockTime(row?.first_in ?? null)} />
          <Row label="Out" value={formatClockTime(row?.last_out ?? null)} />
          {row?.is_late && <Row label="Late" value="Yes" />}
          {row?.is_early_exit && <Row label="Early exit" value="Yes" />}
        </dl>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC]">
            Close
          </button>
          {canRegularize && (
            <button
              type="button"
              onClick={() => onRequestRegularization(date)}
              className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699]"
            >
              Request regularization
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">{label}</dt>
      <dd className="text-[#0F172A]">{value}</dd>
    </div>
  );
}
