export type AuditEntityType = 'account' | 'entry';

export interface AuditLogEntry {
  id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  tab: string | null;
  before_data: Record<string, unknown>;
  actor_id: string | null;
  actor_email: string;
  restored_at: string | null;
  restored_by_email: string | null;
  created_at: string;
}
