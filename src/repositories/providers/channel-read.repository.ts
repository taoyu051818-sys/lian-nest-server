import { Injectable } from '@nestjs/common';
import { IChannelReadRepository, ChannelRead } from '../interfaces';

/**
 * Skeleton channel read repository.
 *
 * TODO: Replace with Redis implementation (issue #9).
 * Storage boundary: Redis (primary), Postgres (persistence).
 */
@Injectable()
export class ChannelReadRepository implements IChannelReadRepository {
  async findByUserAndChannel(
    _userId: string,
    _channelType: string,
    _channelIdentifier: string,
  ): Promise<ChannelRead | null> {
    throw new Error('ChannelReadRepository.findByUserAndChannel not implemented');
  }

  async findByUserId(_userId: string): Promise<ChannelRead[]> {
    throw new Error('ChannelReadRepository.findByUserId not implemented');
  }

  async upsert(
    _read: Omit<ChannelRead, 'id' | 'updatedAt'>,
  ): Promise<ChannelRead> {
    throw new Error('ChannelReadRepository.upsert not implemented');
  }

  async deleteByUserId(_userId: string): Promise<void> {
    throw new Error('ChannelReadRepository.deleteByUserId not implemented');
  }

  async deleteByChannel(
    _channelType: string,
    _channelIdentifier: string,
  ): Promise<void> {
    throw new Error('ChannelReadRepository.deleteByChannel not implemented');
  }
}
