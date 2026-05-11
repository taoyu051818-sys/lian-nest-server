import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../nodebb/types';
import { PostsPaginationQuery, UserDetail, UserPostItem, UserPostsResponse } from './types';

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

  async getPosts(uid: string, query?: PostsPaginationQuery): Promise<UserPostsResponse> {
    const numericUid = this.parseUid(uid);
    const { page, perPage } = this.coercePagination(query);

    try {
      const response = await this.usersProvider.getPosts(numericUid);

      if (response.status !== BodyStatus.OK || !response.data) {
        return { posts: [], source: 'fallback', totalPosts: 0, page, perPage };
      }

      const allPosts: UserPostItem[] = response.data.map((post) => ({
        pid: post.pid,
        tid: post.tid,
        uid: post.uid,
        content: post.content,
        timestamp: new Date(post.timestamp).toISOString(),
      }));

      const totalPosts = allPosts.length;
      const start = (page - 1) * perPage;
      const posts = allPosts.slice(start, start + perPage);

      return { posts, source: 'nodebb', totalPosts, page, perPage };
    } catch {
      return { posts: [], source: 'fallback', totalPosts: 0, page, perPage };
    }
  }

  private parseUid(uid: string): number {
    const numericUid = Number(uid);
    if (!Number.isInteger(numericUid) || numericUid <= 0) {
      throw new NotFoundException(`Invalid uid: ${uid}`);
    }
    return numericUid;
  }

  private coercePagination(query?: PostsPaginationQuery): { page: number; perPage: number } {
    const page = this.coercePositiveInt(query?.page, 1, 'page');
    const perPage = this.coercePositiveInt(query?.perPage, 20, 'perPage');

    if (perPage > 100) {
      throw new BadRequestException('perPage must not exceed 100');
    }

    return { page, perPage };
  }

  private coercePositiveInt(value: string | undefined, defaultValue: number, field: string): number {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) {
      throw new BadRequestException(`Invalid ${field}: ${value}`);
    }
    return num;
  }
}
