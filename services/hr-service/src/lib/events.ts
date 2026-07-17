import { pgNotify } from '@crm/db';

// ─────────────────────────────────────────────────────────────────────────────
// In-app/email notifications for leave events.
//
// Reuses the existing notifications pathway: leads-service publishes to the
// Postgres `crm_events` NOTIFY channel and notifications-service (PgNotifyTransport)
// LISTENs and fans out over SSE. Its connection-manager delivers an event to a
// non-admin client only when the client's org matches AND the client is the
// event's `assigned_user_id` or `actor_id`. We therefore set `assigned_user_id`
// to the intended recipient (the approver or, for decisions, the requester) so
// the generic broadcaster routes it correctly — no change to notifications-service.
//
// `type` is a new, minimal leave event type in the shared channel:
//   leave:approval_pending  → sent to the approver whose level is now pending
//   leave:approved          → sent to the requester on final approval
//   leave:rejected          → sent to the requester on rejection
//
// The same pathway carries attendance face-review notifications:
//   attendance:face_review_pending → sent to the punching user's manager when a
//     flagged face mismatch creates a pending review.
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL = 'crm_events';

export type LeaveEventType = 'leave:approval_pending' | 'leave:approved' | 'leave:rejected';

interface LeaveEventInput {
  type: LeaveEventType;
  request_id: string;
  recipient_id: string;
  org_id: string;
  tenant_id: string;
  actor_id: string;
}

// Fire-and-forget: a notification failure must never fail the leave operation
// that triggered it (the DB transaction has already committed).
export async function publishLeaveEvent(input: LeaveEventInput): Promise<void> {
  try {
    await pgNotify(CHANNEL, {
      type: input.type,
      // Shaped to satisfy the existing broadcaster's routing/security filter.
      lead_id: input.request_id,
      org_id: input.org_id,
      tenant_id: input.tenant_id,
      assigned_user_id: input.recipient_id,
      actor_id: input.actor_id,
      ts: Date.now(),
    });
  } catch (err) {
    console.error('[hr-service] publishLeaveEvent failed:', (err as Error).message, input.type);
  }
}

export type AttendanceEventType = 'attendance:face_review_pending';

interface AttendanceEventInput {
  type: AttendanceEventType;
  /** The attendance event id under review. */
  event_id: string;
  /** Intended recipient (the punching user's manager). */
  recipient_id: string;
  org_id: string;
  tenant_id: string;
  /** The user whose punch triggered the review. */
  actor_id: string;
}

// Fire-and-forget: a notification failure must never fail the punch that already
// committed. Shaped to satisfy the existing broadcaster's routing/security filter.
export async function publishAttendanceEvent(input: AttendanceEventInput): Promise<void> {
  try {
    await pgNotify(CHANNEL, {
      type: input.type,
      lead_id: input.event_id,
      org_id: input.org_id,
      tenant_id: input.tenant_id,
      assigned_user_id: input.recipient_id,
      actor_id: input.actor_id,
      ts: Date.now(),
    });
  } catch (err) {
    console.error('[hr-service] publishAttendanceEvent failed:', (err as Error).message, input.type);
  }
}
