import type { LeaveStatusName } from '../../lib/leave/types';
import { LEAVE_STATUS_STYLES } from '../../lib/leave/format';

interface Props {
  status: LeaveStatusName;
  label?: string;
}

export default function StatusChip({ status, label }: Props) {
  const style = LEAVE_STATUS_STYLES[status] ?? LEAVE_STATUS_STYLES.draft;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style.bg} ${style.fg}`}
    >
      {label ?? status}
    </span>
  );
}
