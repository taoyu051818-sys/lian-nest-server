import { Injectable } from '@nestjs/common';
import {
  IAuditEventRepository,
  AuditEvent,
  AuditEventQuery,
} from '../interfaces';

/**
 * Skeleton audit event repository.
 *
 * TODO: Replace with Prisma implementation (issue #9).
 * Storage boundary: Postgres (primary), with retention policy.
 */
@Injectable()
export class AuditEventRepository implements IAuditEventRepository {
  async findById(_id: string): Promise<AuditEvent | null> {
    throw new Error('AuditEventRepository.findById not implemented');
  }

  async query(_filter: AuditEventQuery): Promise<AuditEvent[]> {
    throw new Error('AuditEventRepository.query not implemented');
  }

  async create(
    _event: Omit<AuditEvent, 'id' | 'createdAt'>,
  ): Promise<AuditEvent> {
    throw new Error('AuditEventRepository.create not implemented');
  }

  async countByAction(
    _action: string,
    _fromDate: Date,
    _toDate: Date,
  ): Promise<number> {
    throw new Error('AuditEventRepository.countByAction not implemented');
  }

  async deleteOlderThan(_date: Date): Promise<number> {
    throw new Error('AuditEventRepository.deleteOlderThan not implemented');
  }
}
