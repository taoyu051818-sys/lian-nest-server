import {
  Injectable,
  NotImplementedException,
  NotFoundException,
} from '@nestjs/common';
import {
  NodebbPostsProvider,
  NodebbTopicsProvider,
  BodyStatus,
} from '../nodebb';
import type {
  PostDetail,
  PostListItem,
  PostPaginatedList,
  PostReactionSummary,
  PostReply,
  CreatePostBody,
  UpdatePostBody,
  CreateReactionBody,
  CreateReplyBody,
  ListPostsQuery,
  ListRepliesQuery,
} from './types';

/**
 * Use-case layer for the Posts domain.
 *
 * getPostDetail is the first runtime endpoint (issue #121).
 * All other methods remain contract stubs.
 */
@Injectable()
export class PostsService {
  constructor(
    private readonly postsProvider: NodebbPostsProvider,
    private readonly topicsProvider: NodebbTopicsProvider,
  ) {}

  // ---- Read ----------------------------------------------------------------

  async listPosts(query: ListPostsQuery): Promise<PostPaginatedList> {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const perPage = Math.max(1, Math.min(100, Math.floor(Number(query.perPage) || 20)));

    const res = await this.topicsProvider.list({ page });

    if (res.status !== BodyStatus.OK || !res.data) {
      return { items: [], totalCount: 0, page, perPage };
    }

    const topics = res.data.topics ?? [];

    const items: PostListItem[] = topics.map((t) => ({
      id: String(t.mainPid),
      author: { uid: t.uid, username: '', avatar: null, reputation: 0 },
      content: t.title,
      createdAt: new Date(t.timestamp * 1000).toISOString(),
      replyCount: Math.max(0, (t.postcount ?? 1) - 1),
    }));

    return { items, totalCount: items.length, page, perPage };
  }

  async getPostDetail(postId: string): Promise<PostDetail> {
    const pid = Number(postId);
    if (!Number.isFinite(pid) || pid < 1) {
      throw new NotFoundException(`Post ${postId} not found`);
    }

    const postRes = await this.postsProvider.getByPid(pid);
    if (postRes.status === BodyStatus.NOT_FOUND || !postRes.data) {
      throw new NotFoundException(`Post ${postId} not found`);
    }
    const post = postRes.data;

    const topicRes = await this.topicsProvider.getById(post.tid);
    const topic = topicRes.data;

    return {
      pid: post.pid,
      tid: post.tid,
      title: topic?.title ?? '',
      slug: topic?.slug ?? '',
      content: post.content,
      contentHtml: '',
      author: {
        uid: post.uid,
        username: '',
        avatar: null,
        reputation: 0,
      },
      timestamp: post.timestamp,
      editedTimestamp: post.edited ?? null,
      editedByUid: null,
      voteCount: 0,
      bookmarkCount: 0,
      replyCount: 0,
      viewCount: topic?.viewcount ?? 0,
      tags: [],
      isPinned: false,
      isLocked: false,
      isDeleted: post.deleted ?? false,
      topic: {
        tid: topic?.tid ?? post.tid,
        title: topic?.title ?? '',
        slug: topic?.slug ?? '',
        cid: topic?.cid ?? 0,
        categoryName: '',
        tagWhitelist: [],
        postCount: topic?.postcount ?? 0,
        viewCount: topic?.viewcount ?? 0,
        timestamp: topic?.timestamp ?? post.timestamp,
        lastPostTime: topic?.timestamp ?? post.timestamp,
        isPinned: false,
        isLocked: false,
        isDeleted: false,
      },
    };
  }

  // ---- Write ---------------------------------------------------------------

  createPost(_body: CreatePostBody): PostDetail {
    throw new NotImplementedException('PostsService.createPost');
  }

  updatePost(_postId: string, _body: UpdatePostBody): PostDetail {
    throw new NotImplementedException('PostsService.updatePost');
  }

  deletePost(_postId: string): { deleted: true } {
    throw new NotImplementedException('PostsService.deletePost');
  }

  // ---- Reactions -----------------------------------------------------------

  listReactions(_postId: string): PostReactionSummary[] {
    throw new NotImplementedException('PostsService.listReactions');
  }

  addReaction(_postId: string, _body: CreateReactionBody): PostReactionSummary {
    throw new NotImplementedException('PostsService.addReaction');
  }

  removeReaction(_postId: string, _reactionType: string): { removed: true } {
    throw new NotImplementedException('PostsService.removeReaction');
  }

  // ---- Replies -------------------------------------------------------------

  async listReplies(
    postId: string,
    query: ListRepliesQuery,
  ): Promise<{ items: PostReply[]; totalCount: number; page: number; perPage: number }> {
    const pid = Number(postId);
    if (!Number.isFinite(pid) || pid < 1) {
      throw new NotFoundException(`Post ${postId} not found`);
    }

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const postRes = await this.postsProvider.getByPid(pid);
    if (postRes.status === BodyStatus.NOT_FOUND || !postRes.data) {
      throw new NotFoundException(`Post ${postId} not found`);
    }
    const parentPost = postRes.data;

    const topicRes = await this.postsProvider.getByTid(parentPost.tid, { page });
    if (topicRes.status !== BodyStatus.OK || !topicRes.data) {
      return { items: [], totalCount: 0, page, perPage };
    }

    const topicPosts = topicRes.data.posts ?? [];
    const totalCount = Math.max(0, (topicRes.data.postcount ?? 0) - 1);

    const items: PostReply[] = topicPosts
      .filter((p) => p.pid !== pid)
      .map((p) => ({
        id: String(p.pid),
        postId,
        author: {
          uid: p.uid,
          username: '',
          avatar: null,
          reputation: 0,
        },
        content: p.content,
        createdAt: new Date(p.timestamp * 1000).toISOString(),
        ...(p.edited
          ? { updatedAt: new Date(p.edited * 1000).toISOString() }
          : {}),
      }));

    return { items, totalCount, page, perPage };
  }

  createReply(_postId: string, _body: CreateReplyBody): PostReply {
    throw new NotImplementedException('PostsService.createReply');
  }

  deleteReply(_postId: string, _replyId: string): { deleted: true } {
    throw new NotImplementedException('PostsService.deleteReply');
  }
}
