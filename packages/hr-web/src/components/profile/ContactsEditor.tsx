'use client';

import { useState } from 'react';
import { Button, Modal } from '@platform/ui-kit';
import { profile } from '../../lib/api/client';
import type { EmergencyContact } from '../../lib/profile/types';
import { emptyBlockCls, fieldInputCls, fieldLabelCls } from '../../lib/ui';

/** What the editor calls. Defaults to the signed-in person's own contacts (My profile). */
export interface ContactActions {
  add: (body: Omit<EmergencyContact, 'id'>) => Promise<unknown>;
  update: (id: string, body: Partial<Omit<EmergencyContact, 'id'>>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

const SELF_ACTIONS: ContactActions = {
  add: (b) => profile.addContact(b),
  update: (id, b) => profile.updateContact(id, b),
  remove: (id) => profile.removeContact(id),
};

interface Props {
  contacts: EmergencyContact[];
  /** Another person's contacts (HR editing from Team): pass their endpoints. */
  actions?: ContactActions;
  /** Re-fetch after any change. */
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}

/** The employee's own emergency contacts: list, add, edit, remove. One may be primary. */
export default function ContactsEditor({ contacts, onChanged, onError, actions = SELF_ACTIONS }: Props) {
  // null = closed; 'new' = adding; a contact = editing it.
  const [editing, setEditing] = useState<EmergencyContact | 'new' | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const remove = async (c: EmergencyContact) => {
    setRemovingId(c.id);
    try {
      await actions.remove(c.id);
      onChanged('Emergency contact removed.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not remove the contact.');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {contacts.length === 0 ? (
        <p className={emptyBlockCls}>No emergency contacts yet. Add someone we can reach if something happens.</p>
      ) : (
        <ul className="divide-y divide-outline-variant/50 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-on-surface">
                  {c.name}
                  {c.is_primary && (
                    <span className="ml-2 rounded-full bg-primary-fixed px-2 py-0.5 text-label-sm font-semibold text-on-primary-fixed">Primary</span>
                  )}
                </p>
                <p className="text-xs text-on-surface-variant">{c.relation} · {c.phone}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setEditing(c)} className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-fixed">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c)}
                  disabled={removingId === c.id}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container disabled:opacity-50"
                >
                  {removingId === c.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setEditing('new')}>+ Add contact</Button>

      {editing && (
        <ContactModal
          contact={editing === 'new' ? null : editing}
          actions={actions}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); onChanged(message); }}
        />
      )}
    </div>
  );
}

function ContactModal({ contact, actions, onClose, onSaved }: {
  contact: EmergencyContact | null;
  actions: ContactActions;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(contact?.name ?? '');
  const [relation, setRelation] = useState(contact?.relation ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [primary, setPrimary] = useState(contact?.is_primary ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!name.trim() || !relation.trim() || phone.trim().length < 5) {
      setError('Name, relation and a phone number are required.');
      return;
    }
    setBusy(true);
    try {
      const body = { name: name.trim(), relation: relation.trim(), phone: phone.trim(), is_primary: primary };
      if (contact) await actions.update(contact.id, body);
      else await actions.add(body);
      onSaved(contact ? 'Emergency contact updated.' : 'Emergency contact added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the contact.');
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={busy}
        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60">
        Cancel
      </button>
      <button type="button" onClick={save} disabled={busy}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60">
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={contact ? 'Edit emergency contact' : 'Add emergency contact'} locked={busy} maxWidth="max-w-md" footer={footer}>
      <div className="flex flex-col gap-3">
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ec-name" className={fieldLabelCls}>Name</label>
          <input id="ec-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={fieldInputCls} disabled={busy} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ec-relation" className={fieldLabelCls}>Relation</label>
          <input id="ec-relation" value={relation} onChange={(e) => setRelation(e.target.value)} maxLength={50} placeholder="e.g. Spouse, Parent" className={fieldInputCls} disabled={busy} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ec-phone" className={fieldLabelCls}>Phone</label>
          <input id="ec-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} className={fieldInputCls} disabled={busy} />
        </div>
        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} disabled={busy} className="h-4 w-4 rounded border-outline-variant accent-primary" />
          Primary contact
        </label>
      </div>
    </Modal>
  );
}
