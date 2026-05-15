export interface ReviewEntry {
  id: string;
  sheet_row_id: string;

  agent: string | null;
  account: string | null;
  country: string | null;
  proxy_used: string | null;
  email: string | null;
  password: string | null;
  account_name: string | null;
  account_surname: string | null;

  process: string | null;
  details: string | null;
  brand: string | null;

  status_date: string | null;       // ISO date 'YYYY-MM-DD'
  score_added: number | null;
  trustpilot_date: string | null;   // ISO date 'YYYY-MM-DD'
  profile_url: string | null;
  review_status: string | null;

  redirection_search_engine: string | null;
  redirection_word: string | null;
  review_language: string | null;
  native_language: string | null;

  register_from_google: string | null;
  leaving_review_after_email: string | null;
  sticky_ip_mobile: string | null;
  photo_in_account: string | null;
  device: string | null;
  opening_via_useful: string | null;
  opening_via_register: string | null;
  scrolling_hovering: string | null;
  smart_paste: string | null;
  mentioning_time_frames: string | null;
  mentioning_amounts: string | null;
  mentioning_agent_name: string | null;
  review_length: string | null;

  updated_at: string;
  last_edited_by: 'dashboard' | 'sheet';
  last_sync_tag: string | null;
}

export type ReviewEntryDraft = Omit<
  ReviewEntry,
  'id' | 'sheet_row_id' | 'updated_at' | 'last_edited_by' | 'last_sync_tag'
>;

export const REVIEW_ENTRY_EDITABLE_FIELDS = [
  'agent', 'account', 'country', 'proxy_used', 'email', 'password',
  'account_name', 'account_surname',
  'process', 'details', 'brand',
  'status_date', 'score_added', 'trustpilot_date', 'profile_url', 'review_status',
  'redirection_search_engine', 'redirection_word', 'review_language', 'native_language',
  'register_from_google', 'leaving_review_after_email', 'sticky_ip_mobile',
  'photo_in_account', 'device', 'opening_via_useful', 'opening_via_register',
  'scrolling_hovering', 'smart_paste', 'mentioning_time_frames',
  'mentioning_amounts', 'mentioning_agent_name', 'review_length',
] as const satisfies ReadonlyArray<keyof ReviewEntryDraft>;
