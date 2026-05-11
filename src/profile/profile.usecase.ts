import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../nodebb/types';
import {
  PublicProfile,
  SavedItem,
  LikedItem,
  HistoryItem,
  ProfileCollection,
  CollectionQuery,
} from './types';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

@Injectable()
export class ProfileUsecase {
  constructor(private readonly usersProvider: NodebbUsersProvider) {}

  async getPublicProfile(uid: string): Promise<PublicProfile> {
    const numericUid = this.parseUid(uid);

    const response = await this.usersProvider.getByUid(numericUid);

    if (response.status === BodyStatus.NOT_FOUND || !response.data) {
      throw new NotFoundException(`User ${uid} not found`);
    }

    const user = response.data;
    return {
      uid: String(user.uid),
      username: user.username,
      displayName: user.username,
      avatar: null,
      bio: null,
      postCount: user.postcount,
      reputation: user.reputation,
      joinedAt: new Date(user.joindate).toISOString(),
    };
  }

  async getSaved(
    uid: string,
    query?: CollectionQuery,
  ): Promise<ProfileCollection<SavedItem>> {
    const numericUid = this.parseUid(uid);
    const { page, pageSize } = this.parsePagination(query);

    try {
      const response = await this.usersProvider.getSaved(numericUid);

      if (response.status !== BodyStatus.OK || !response.data) {
        return this.emptyFallback(page, pageSize);
      }

      const items: SavedItem[] = response.data.map((entry) => ({
        id: String(entry.id),
        type: entry.type,
        targetId: String(entry.targetId),
        savedAt: new Date(entry.timestamp).toISOString(),
      }));

      return {
        items,
        total: items.length,
        page,
        pageSize,
        source: 'nodebb',
      };
    } catch {
      return this.emptyFallback(page, pageSize);
    }
  }

  async getLiked(uid: string): Promise<ProfileCollection<LikedItem>> {
    throw new Error(
      `getLiked(${uid}) not implemented — awaiting NodeBB collection wiring`,
    );
  }

  async getHistory(uid: string): Promise<ProfileCollection<HistoryItem>> {
    throw new Error(
      `getHistory(${uid}) not implemented — awaiting NodeBB collection wiring`,
    );
  }

  private parseUid(uid: string): number {
    const numericUid = Number(uid);
    if (!Number.isInteger(numericUid) || numericUid <= 0) {
      throw new NotFoundException(`Invalid uid: ${uid}`);
    }
    return numericUid;
  }

  private parsePagination(query?: CollectionQuery): {
    page: number;
    pageSize: number;
  } {
    const page = query?.page ?? DEFAULT_PAGE;
    const pageSize = query?.pageSize ?? DEFAULT_PAGE_SIZE;

    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new BadRequestException(
        `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`,
      );
    }

    return { page, pageSize };
  }

  private emptyFallback(
    page: number,
    pageSize: number,
  ): ProfileCollection<SavedItem> {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      source: 'fallback',
    };
  }
}
