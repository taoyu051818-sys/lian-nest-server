/**
 * Audit event repository interface.
 *
 * Records security-relevant events for compliance
 * and incident investigation.
 */

export interface AuditEvent {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditEventQuery {
  userId?: string;
  action?: string;
  resourceType?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface IAuditEventRepository {
  findById(id: string): Promise<AuditEvent | null>;
  query(filter: AuditEventQuery): Promise<AuditEvent[]>;
  create(event: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<AuditEvent>;
  countByAction(action: string, fromDate: Date, toDate: Date): Promise<number>;
  deleteOlderThan(date: Date): Promise<number>;
}
