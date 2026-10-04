import { logActivity } from '@platform/audit-log';
import { can, CAPABILITY, type CapabilityHolder } from '@platform/rbac';
import * as repo from './swaps.repository.js';
import type { SwapCtx } from './swaps.repository.js';
import type { CreateShiftSwapInput } from './swaps.schema.js';

/** Branch-wide reach (whole-branch roster, deciding any swap): the attendance admin page. */
export const hasBranchReach = (actor: CapabilityHolder): boolean => can(actor, CAPABILITY.HR_ATTENDANCE_ADMIN);

// The audit row records THAT it happened and who it concerned, never the reason text.
const audit = (ctx: SwapCtx, action: string, subject: string, extra?: Record<string, unknown>) =>
  void logActivity({
    action_type: action,
    performed_by: ctx.user_id,
    subject_user_id: subject,
    org_id: ctx.org_id,
    ...(extra ? { new_value: extra } : {}),
  });

export const getRoster = (ctx: SwapCtx, from: string | undefined, seeAll: boolean) => repo.getRoster(ctx, from, seeAll);
export const listMine = (ctx: SwapCtx) => repo.listMine(ctx);
export const listQueue = (ctx: SwapCtx, seeAll: boolean) => repo.listQueue(ctx, seeAll);

export async function createSwap(ctx: SwapCtx, data: CreateShiftSwapInput) {
  const r = await repo.createSwap(ctx, data);
  audit(ctx, 'shift_swap_requested', data.peer_id, { swap_id: r.id, swap_date: data.swap_date });
  return r;
}

export async function respond(ctx: SwapCtx, id: string, accept: boolean) {
  const r = await repo.respond(ctx, id, accept);
  audit(ctx, accept ? 'shift_swap_accepted' : 'shift_swap_declined', r.requester_id, { swap_id: id });
  return r;
}

export async function cancel(ctx: SwapCtx, id: string) {
  const r = await repo.cancel(ctx, id);
  audit(ctx, 'shift_swap_cancelled', ctx.user_id, { swap_id: id });
  return r;
}

export async function decide(ctx: SwapCtx, id: string, approve: boolean, comment: string | null, override: boolean) {
  const r = await repo.decide(ctx, id, approve, comment, override);
  audit(ctx, approve ? 'shift_swap_approved' : 'shift_swap_rejected', r.requester_id, { swap_id: id, peer_id: r.peer_id });
  return r;
}
