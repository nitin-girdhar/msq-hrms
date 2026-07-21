// Form control styling, shared so the attendance screens stop drifting apart.
//
// The same class string had been pasted into RulesEditor, MonthlySummaryReport,
// ShiftFormModal and ShiftAssignmentFormModal, and the field labels had already
// split into two treatments (#0F172A semibold in the modals, #475569 medium in
// the report). Pulling both here makes a change land everywhere at once.
//
// Sizing is pinned to @platform/ui-kit's Button: `md` is a 40px control with
// rounded-lg corners, so an input sitting next to a button lines up instead of
// being 2px taller with a rounder radius (the old rounded-xl / py-2.5 pair).

export const fieldLabelCls = 'text-xs font-medium text-[#475569]';

export const fieldInputCls =
  'h-10 rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm text-[#0F172A] shadow-sm ' +
  'placeholder:text-[#CBD5E1] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 ' +
  'disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]';

// Centred placeholder for a list that is loading or has nothing in it. Repeated
// verbatim in every admin tab before this.
export const stateBlockCls =
  'flex items-center justify-center py-12 text-sm text-[#94A3B8]';

export const emptyBlockCls =
  'rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]';
