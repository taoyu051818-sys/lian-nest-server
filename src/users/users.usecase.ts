import { Injectable, NotFoundException } from '@nestjs/common';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../nodebb/types';
import { UserDetail } from './types';

@Injectable()
export class UsersUsecase {
  constructor(private readonly usersProvider: NodebbUsersProvider) {}

  async getByUid(uid: string): Promise<UserDetail> {
    const numericUid = this.parseUid(uid);

    const response = await this.usersProvider.getByUid(numericUid);

    if (response.status === BodyStatus.NOT_FOUND || !response.data) {
      throw new NotFoundException(`User ${uid} not found`);
    }

    const user = response.data;
    return {
      uid: String(user.uid),
      username: user.username,
      userslug: user.userslug,
      joinedAt: new Date(user.joindate).toISOString(),
      reputation: user.reputation,
      postCount: user.postcount,
    };
  }

  private parseUid(uid: string): number {
    const numericUid = Number(uid);
    if (!Number.isInteger(numericUid) || numericUid <= 0) {
      throw new NotFoundException(`Invalid uid: ${uid}`);
    }
    return numericUid;
  }
}
