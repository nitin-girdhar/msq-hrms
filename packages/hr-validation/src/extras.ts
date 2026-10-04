import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// ── Announcements (schema 1.63.0) ───────────────────────────────────────────
export const ANNOUNCEMENT_CATEGORIES = ['general', 'policy', 'event', 'celebration'] as const;

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(150),
  body: z.string().trim().min(1, 'Write the announcement').max(4000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).default('general'),
  is_pinned: z.boolean().default(false),
  expires_on: isoDate.optional(),
  // true = visible to the branch straight away; false = save as a draft.
  publish: z.boolean().default(true),
});

// ── Assets ───────────────────────────────────────────────────────────────────
export const ASSET_CATEGORIES = ['laptop', 'monitor', 'phone', 'access_card', 'other'] as const;

export const createAssetSchema = z.object({
  asset_tag: z.string().trim().min(1, 'An asset tag is required').max(50),
  name: z.string().trim().min(1, 'A name is required').max(150),
  category: z.enum(ASSET_CATEGORIES).default('other'),
  serial_no: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const assignAssetSchema = z.object({
  user_id: z.string().uuid(),
  note: z.string().trim().max(300).optional(),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type AssignAssetInput = z.infer<typeof assignAssetSchema>;
