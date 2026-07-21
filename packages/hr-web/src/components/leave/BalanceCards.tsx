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
    // Same flex-wrap tile rhythm as the LMS StatsCards row rather than a fixed
    // 4-column grid — with 2-4 leave types a grid stretched each card to ~290px
    // for one number, which is what made the page read as sparse next to LMS.
    <div className="flex flex-wrap gap-1.5">
      {balances.map((b) => (
        <div
          key={b.leave_type_id}
          // max-w keeps a 2-4 type org from stretching each tile to a third of
          // the viewport for a single number; LMS gets away with plain flex-1
          // only because it always renders 7-8 cards.
          className="flex min-w-[130px] max-w-[220px] flex-1 flex-col gap-1 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[9px] font-semibold uppercase leading-tight tracking-widest text-[#64748B]">
              {b.leave_type_label}
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                b.is_paid ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {b.is_paid ? 'Paid' : 'Unpaid'}
            </span>
          </div>
          <span className="text-lg font-bold tabular-nums text-[#0F172A]">{b.balance}</span>
          <p className="text-[9px] text-[#94A3B8]">days available</p>
        </div>
      ))}
    </div>
  );
}
