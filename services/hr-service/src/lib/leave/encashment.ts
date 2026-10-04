// Leave encashment rules. Pure: the repository gathers the policy and the balance and
// applies the verdict. Encashment cashes out UNUSED days of a leave type whose policy
// allows it; approval writes a negative 'encashment' ledger entry.

export interface EncashmentPolicy {
  encashable: boolean;
  /** Cap per request; null = no cap beyond the balance. */
  maxEncashDays: number | null;
}

export type EncashmentVerdict = { ok: true } | { ok: false; reason: string };

/**
 * May `days` of this leave type be cashed out?
 *
 * `balance` is what the ledger holds now; `alreadyPending` is the days in the
 * employee's other open encashment requests for the same type, so two requests
 * cannot together claim more than exists.
 */
export function checkEncashment(input: {
  policy: EncashmentPolicy | null;
  days: number;
  balance: number;
  alreadyPending?: number;
}): EncashmentVerdict {
  const { policy, days, balance } = input;
  const pending = input.alreadyPending ?? 0;
  if (!policy) return { ok: false, reason: 'There is no leave policy for that leave type' };
  if (!policy.encashable) return { ok: false, reason: 'That leave type cannot be encashed' };
  if (!(days > 0)) return { ok: false, reason: 'Enter the number of days to encash' };
  // Whole or half days only, like leave itself.
  if (Math.round(days * 2) !== days * 2) return { ok: false, reason: 'Days must be a whole or half number' };
  if (policy.maxEncashDays != null && days > policy.maxEncashDays) {
    return { ok: false, reason: `At most ${policy.maxEncashDays} days can be encashed at a time` };
  }
  const available = balance - pending;
  if (days > available) {
    return { ok: false, reason: `You only have ${Math.max(0, available)} days available to encash` };
  }
  return { ok: true };
}
