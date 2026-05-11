/**
 * Channel read repository interface.
 *
 * Tracks user read positions in channels/topics
 * for unread indicators and sync state.
 */

export interface ChannelRead {
  id: string;
  userId: string;
  channelType: 'topic' | 'category' | 'chat';
  channelIdentifier: string;
  lastReadPostId: number;
  lastReadTimestamp: Date;
  updatedAt: Date;
}

export interface IChannelReadRepository {
  findByUserAndChannel(
    userId: string,
    channelType: string,
    channelIdentifier: string,
  ): Promise<ChannelRead | null>;
  findByUserId(userId: string): Promise<ChannelRead[]>;
  upsert(
    read: Omit<ChannelRead, 'id' | 'updatedAt'>,
  ): Promise<ChannelRead>;
  deleteByUserId(userId: string): Promise<void>;
  deleteByChannel(channelType: string, channelIdentifier: string): Promise<void>;
}
