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

  listPosts(_query: ListPostsQuery): PostPaginatedList {
    throw new NotImplementedException('PostsService.listPosts');
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

  listReplies(
    _postId: string,
    _query: ListRepliesQuery,
  ): { items: PostReply[]; totalCount: number; page: number; perPage: number } {
    throw new NotImplementedException('PostsService.listReplies');
  }

  createReply(_postId: string, _body: CreateReplyBody): PostReply {
    throw new NotImplementedException('PostsService.createReply');
  }

  deleteReply(_postId: string, _replyId: string): { deleted: true } {
    throw new NotImplementedException('PostsService.deleteReply');
  }
}
