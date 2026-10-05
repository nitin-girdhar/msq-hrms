// Documents vault shapes (schema 1.65.0). snake_case, matching the API.

export const DOCUMENT_CATEGORIES = ['id_proof', 'address_proof', 'education', 'employment', 'tax_proof', 'medical', 'other'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export type DocumentStatus = 'pending' | 'verified' | 'rejected';

export const DOCUMENT_CATEGORY_LABEL: Record<string, string> = {
  id_proof: 'ID proof',
  address_proof: 'Address proof',
  education: 'Education',
  employment: 'Employment',
  tax_proof: 'Tax proof',
  medical: 'Medical',
  other: 'Other',
};

/** The ceiling HR can raise the limit to (3.5 MiB: its base64 still fits the 5 MB request). */
export const DOCUMENT_MAX_BYTES = 3_670_016;
export const DOCUMENT_MIN_BYTES = 100 * 1024;
/** What applies until HR sets a limit. */
export const DOCUMENT_DEFAULT_BYTES = 3 * 1024 * 1024;
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

export type VaultTab = 'all' | 'identity' | 'work' | 'tax' | 'other';
export const VAULT_TABS: Array<{ id: VaultTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'identity', label: 'ID & address' },
  { id: 'work', label: 'Education & employment' },
  { id: 'tax', label: 'Tax proofs' },
  { id: 'other', label: 'Medical & other' },
];
export const TAB_OF_CATEGORY: Record<string, VaultTab> = {
  id_proof: 'identity', address_proof: 'identity', education: 'work', employment: 'work', tax_proof: 'tax', medical: 'other', other: 'other',
};

/** The Indian financial year (April to March) an ISO timestamp falls in, e.g. "2026-27". */
export function financialYearOf(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export interface EmployeeDocument {
  id: string;
  user_id: string;
  category: string;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  review_note: string | null;
  reviewed_at: string | null;
  expires_on: string | null;
  tax_section: string | null;
  amount: number | null;
  created_at: string;
}

export interface PendingDocument extends EmployeeDocument {
  user_full_name: string;
}

export interface UploadDocumentBody {
  category: DocumentCategory;
  title: string;
  file_name: string;
  data_base64: string;
  expires_on?: string;
  tax_section?: string;
  amount?: number;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 'expired' once past, 'soon' within 30 days, otherwise null. `today` is YYYY-MM-DD. */
export function expiryState(expiresOn: string | null, today: string): 'expired' | 'soon' | null {
  if (!expiresOn) return null;
  if (expiresOn < today) return 'expired';
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 30);
  return expiresOn <= limit.toISOString().slice(0, 10) ? 'soon' : null;
}

/** The file as bare base64 (no data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
