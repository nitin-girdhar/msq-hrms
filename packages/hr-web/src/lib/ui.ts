// Form control styling, shared so the attendance screens stop drifting apart.
//
// The same class string had been pasted into RulesEditor, MonthlySummaryReport,
// ShiftFormModal and ShiftAssignmentFormModal. Pulling it here makes a change
// land everywhere at once.
//
// Colours are theme tokens (@platform/ui-kit/theme.css), never hex, so a tenant
// brand colour, a user's appearance choice and dark mode all reach these controls
// without touching a component. Sizing is pinned to @platform/ui-kit's Button:
// `md` is a 40px control with rounded-lg corners, so an input sitting next to a
// button lines up.

export const fieldLabelCls = 'text-xs font-medium text-on-surface-variant';

export const fieldInputCls =
  'h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface shadow-sm ' +
  'placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-on-surface-variant';

// Centred placeholder for a list that is loading or has nothing in it. Repeated
// verbatim in every admin tab before this.
export const stateBlockCls =
  'flex items-center justify-center py-12 text-sm text-on-surface-variant';

export const emptyBlockCls =
  'rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest px-4 py-8 text-center text-sm text-on-surface-variant';
