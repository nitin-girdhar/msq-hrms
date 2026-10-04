import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// Ask a teammate to take your shift on one future day, and give theirs. Which
// shifts those are is read server-side from the two rosters, never from the client.
export const createShiftSwapSchema = z.object({
  peer_id: z.string().uuid(),
  swap_date: isoDate,
  reason: z.string().trim().min(1, 'Say why you want to swap').max(500),
});

export const respondShiftSwapSchema = z.object({
  accept: z.boolean(),
});

export const decideShiftSwapSchema = z.object({
  comment: z.string().trim().max(1000).optional(),
});

export const rejectShiftSwapSchema = z.object({
  comment: z.string().trim().min(1, 'A comment is required when rejecting').max(1000),
});

export const rosterQuerySchema = z.object({
  // Any date; the server snaps it to the Monday of that week.
  from: isoDate.optional(),
});

export type CreateShiftSwapInput = z.infer<typeof createShiftSwapSchema>;
export type RespondShiftSwapInput = z.infer<typeof respondShiftSwapSchema>;
export type DecideShiftSwapInput = z.infer<typeof decideShiftSwapSchema>;
export type RejectShiftSwapInput = z.infer<typeof rejectShiftSwapSchema>;
export type RosterQueryInput = z.infer<typeof rosterQuerySchema>;
