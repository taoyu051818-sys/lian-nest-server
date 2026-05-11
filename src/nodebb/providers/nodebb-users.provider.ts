import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import {
  NodebbAuth,
  NodebbNormalizedResponse,
  NodebbPost,
  NodebbUser,
} from '../types';

/** Minimal shape for a saved/bookmark entry returned by NodeBB. */
export interface NodebbSavedEntry {
  id: string;
  type: 'topic' | 'post';
  targetId: string;
  timestamp: number;
}

/** Minimal shape for a liked/upvoted entry returned by NodeBB. */
export interface NodebbLikedEntry {
  id: string;
  type: 'topic' | 'post';
  targetId: string;
  timestamp: number;
}

/** Minimal shape for a history/viewed entry returned by NodeBB. */
export interface NodebbHistoryEntry {
  id: string;
  type: 'topic' | 'post';
  targetId: string;
  timestamp: number;
}

@Injectable()
export class NodebbUsersProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async getByUid(
    uid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbUser>> {
    return this.client.get<NodebbUser>(`/api/v3/users/${uid}`, auth);
  }

  async getBySlug(
    slug: string,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbUser>> {
    return this.client.get<NodebbUser>(`/api/v3/user/bySlug/${slug}`, auth);
  }

  /**
   * Fetch saved/bookmarked items for a user.
   *
   * Calls NodeBB bookmarks endpoint. The exact response shape is
   * implementation-dependent; callers should treat errors as "no data"
   * and fall back gracefully.
   */
  async getSaved(
    uid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbSavedEntry[]>> {
    return this.client.get<NodebbSavedEntry[]>(
      `/api/v3/users/${uid}/bookmarks`,
      auth,
    );
  }

  /**
   * Fetch liked/upvoted items for a user.
   *
   * Calls NodeBB upvoted endpoint. The exact response shape is
   * implementation-dependent; callers should treat errors as "no data"
   * and fall back gracefully.
   */
  async getLiked(
    uid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbLikedEntry[]>> {
    return this.client.get<NodebbLikedEntry[]>(
      `/api/v3/users/${uid}/upvoted`,
      auth,
    );
  }

  /**
   * Fetch history/viewed items for a user.
   *
   * Calls NodeBB posts endpoint. The exact response shape is
   * implementation-dependent; callers should treat errors as "no data"
   * and fall back gracefully.
   */
  async getHistory(
    uid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbHistoryEntry[]>> {
    return this.client.get<NodebbHistoryEntry[]>(
      `/api/v3/users/${uid}/posts`,
      auth,
    );
  }

  /**
   * Fetch posts created by a user.
   *
   * Calls NodeBB user posts endpoint.
   */
  async getPosts(
    uid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbPost[]>> {
    return this.client.get<NodebbPost[]>(
      `/api/v3/users/${uid}/posts`,
      auth,
    );
  }
}
