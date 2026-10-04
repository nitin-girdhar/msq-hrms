'use client';

import { useCallback, useState } from 'react';
import type { SessionUser } from '@platform/types';
import { can, CAPABILITY } from '@platform/rbac';
import { Alert, PageBody, PageHeader, PageSection } from '@platform/ui-kit';
import { MyDocumentsPanel, ReviewQueue } from './DocumentsPanels';

interface Props {
  actor: SessionUser;
}

/**
 * Documents & compliance vault (Stitch "Documents"). Everyone with documents.view keeps their
 * own paperwork here (upload, track review, remove); people with documents.manage also get the
 * branch review queue. A person's whole folder, for HR, is the Documents tab on Employee 360.
 * Out of scope: DigiLocker pulls, expiry e-mail reminders, tax-regime comparison.
 */
export default function DocumentsShell({ actor }: Props) {
  const canKeep = can(actor, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_VIEW);
  const canReview = can(actor, CAPABILITY.HR_EMPLOYEES_DOCUMENTS_MANAGE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const onError = useCallback((m: string) => { setNotice(null); setError(m); }, []);
  const onNotice = useCallback((m: string) => { setError(null); setNotice(m); }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Documents" subtitle="ID and address proofs, certificates and tax proofs" />
      <PageBody>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {canReview && (
          <PageSection title="Waiting for review">
            <ReviewQueue onError={onError} onNotice={onNotice} />
          </PageSection>
        )}
        {canKeep && (
          <PageSection title="My documents">
            <MyDocumentsPanel onError={onError} onNotice={onNotice} />
          </PageSection>
        )}
      </PageBody>
    </div>
  );
}
