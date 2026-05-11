import { Injectable } from '@nestjs/common';
import {
  IAIRecordRepository,
  AIRecord,
  AIRecordQuery,
} from '../interfaces';

/**
 * Skeleton AI record repository.
 *
 * TODO: Replace with Prisma implementation (issue #9).
 * Storage boundary: Postgres (primary).
 */
@Injectable()
export class AIRecordRepository implements IAIRecordRepository {
  async findById(_id: string): Promise<AIRecord | null> {
    throw new Error('AIRecordRepository.findById not implemented');
  }

  async findByUserId(
    _userId: string,
    _limit?: number,
  ): Promise<AIRecord[]> {
    throw new Error('AIRecordRepository.findByUserId not implemented');
  }

  async query(_filter: AIRecordQuery): Promise<AIRecord[]> {
    throw new Error('AIRecordRepository.query not implemented');
  }

  async create(
    _record: Omit<AIRecord, 'id' | 'createdAt'>,
  ): Promise<AIRecord> {
    throw new Error('AIRecordRepository.create not implemented');
  }

  async aggregateUsage(
    _userId: string,
    _fromDate: Date,
    _toDate: Date,
  ): Promise<{
    totalTokens: number;
    totalRequests: number;
    avgLatencyMs: number;
  }> {
    throw new Error('AIRecordRepository.aggregateUsage not implemented');
  }
}
