import type { LeaveBalance } from '../../lib/leave/types';

interface Props {
  balances: LeaveBalance[];
}

export default function BalanceCards({ balances }: Props) {
  if (balances.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-6 text-center text-sm text-[#94A3B8]">
        No leave balances yet. Balances appear once a policy and accrual are configured for your org.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {balances.map((b) => (
        <div
          key={b.leave_type_id}
          className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
              {b.leave_type_label}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                b.is_paid ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {b.is_paid ? 'Paid' : 'Unpaid'}
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-[#0F172A]">{b.balance}</div>
          <div className="text-xs text-[#94A3B8]">days available</div>
        </div>
      ))}
    </div>
  );
}
