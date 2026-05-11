import { Injectable, NotFoundException } from '@nestjs/common';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../nodebb/types';
import {
  PublicProfile,
  SavedItem,
  LikedItem,
  HistoryItem,
  ProfileCollection,
} from './types';

@Injectable()
export class ProfileUsecase {
  constructor(private readonly usersProvider: NodebbUsersProvider) {}

  async getPublicProfile(uid: string): Promise<PublicProfile> {
    const numericUid = Number(uid);
    if (!Number.isInteger(numericUid) || numericUid <= 0) {
      throw new NotFoundException(`Invalid uid: ${uid}`);
    }

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

  async getSaved(uid: string): Promise<ProfileCollection<SavedItem>> {
    throw new Error(
      `getSaved(${uid}) not implemented — awaiting NodeBB collection wiring`,
    );
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
}
