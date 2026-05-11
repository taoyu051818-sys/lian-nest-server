/**
 * AI record repository interface.
 *
 * Stores AI interaction records for audit,
 * billing, and quality tracking.
 */

export interface AIRecord {
  id: string;
  userId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: 'success' | 'error' | 'timeout' | 'rate_limited';
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AIRecordQuery {
  userId?: string;
  modelId?: string;
  status?: AIRecord['status'];
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface IAIRecordRepository {
  findById(id: string): Promise<AIRecord | null>;
  findByUserId(userId: string, limit?: number): Promise<AIRecord[]>;
  query(filter: AIRecordQuery): Promise<AIRecord[]>;
  create(record: Omit<AIRecord, 'id' | 'createdAt'>): Promise<AIRecord>;
  aggregateUsage(userId: string, fromDate: Date, toDate: Date): Promise<{
    totalTokens: number;
    totalRequests: number;
    avgLatencyMs: number;
  }>;
}
