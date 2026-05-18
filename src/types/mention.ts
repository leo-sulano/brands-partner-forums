export type MentionStatus = 'new' | 'reviewed' | 'ignored';
export type Sentiment = 'positive' | 'neutral' | 'negative' | null;

export interface Mention {
  id: string;
  tab: string;
  source_row_id: string;
  forum: string;
  thread_title: string | null;
  mention_text: string;
  url: string;
  author: string | null;
  posted_at: string | null;
  keyword: string | null;
  sentiment: Sentiment;
  status: MentionStatus;
  synced_at: string;
}
