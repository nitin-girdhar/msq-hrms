// Announcements + assets shapes (schema 1.63.0). snake_case, matching the API.

export const ANNOUNCEMENT_CATEGORIES = ['general', 'policy', 'event', 'celebration'] as const;
export const ASSET_CATEGORIES = ['laptop', 'monitor', 'phone', 'access_card', 'other'] as const;

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: string;
  is_pinned: boolean;
  published_at: string | null;
  expires_on: string | null;
  author_name: string | null;
  is_read: boolean;
}

export interface MyAsset {
  id: string;
  asset_tag: string;
  name: string;
  category: string;
  serial_no: string | null;
  assigned_on: string;
}

export interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  category: string;
  serial_no: string | null;
  status: 'in_stock' | 'assigned' | 'retired';
  notes: string | null;
  holder_id: string | null;
  holder_name: string | null;
  assigned_on: string | null;
}

export const ASSET_CATEGORY_LABEL: Record<string, string> = {
  laptop: 'Laptop', monitor: 'Monitor', phone: 'Phone', access_card: 'Access card', other: 'Other',
};
