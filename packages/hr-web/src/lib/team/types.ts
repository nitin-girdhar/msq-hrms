// Team roster + shift swap shapes (schema 1.61.0). snake_case, matching the API.

export interface RosterDay {
  date: string;
  kind: 'shift' | 'off' | 'holiday' | 'leave' | 'none';
  shift_name: string | null;
  start: string | null;
  end: string | null;
}

export interface RosterPerson {
  user_id: string;
  full_name: string;
  is_me: boolean;
  days: RosterDay[];
}

export interface Roster {
  week_start: string;
  week_end: string;
  people: RosterPerson[];
}

export type SwapStatus = 'pending_peer' | 'pending_manager' | 'approved' | 'rejected' | 'declined' | 'cancelled';

export interface ShiftSwap {
  id: string;
  swap_date: string;
  status: SwapStatus;
  reason: string;
  requester_id: string;
  requester_name: string;
  peer_id: string;
  peer_name: string;
  requester_shift: string;
  peer_shift: string;
  manager_id: string | null;
  approver_comment: string | null;
  created_at: string;
}

export const SWAP_STATUS_LABEL: Record<string, string> = {
  pending_peer: 'Waiting for teammate',
  pending_manager: 'Waiting for approver',
  approved: 'Approved',
  rejected: 'Rejected',
  declined: 'Declined',
  cancelled: 'Withdrawn',
};
