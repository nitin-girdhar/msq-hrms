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

/** Largest file the server accepts (it re-checks; this only saves a round trip). */
export const DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

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
