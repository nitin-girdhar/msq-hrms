import { logActivity } from '@platform/audit-log';
import * as repo from './internal.repository.js';
import type { SyncOutcome } from './internal.repository.js';
import type { SyncEmployeeProfileInput } from './internal.schema.js';

export async function syncEmployeeProfile(data: SyncEmployeeProfileInput): Promise<{ outcome: SyncOutcome }> {
  const outcome = await repo.syncEmployeeProfile(data);

  if (outcome === 'created' || outcome === 'updated') {
    void logActivity({
      action_type: outcome === 'created' ? 'employee_profile_created' : 'employee_profile_updated',
      performed_by: data.actor_id,
      subject_user_id: data.user_id,
      org_id: data.home_org_id,
      new_value: { org_id: data.home_org_id, is_active: data.is_active, source: 'team_admin' },
    });
  }
  return { outcome };
}
