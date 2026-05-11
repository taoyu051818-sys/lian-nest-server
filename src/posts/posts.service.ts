import { Injectable, NotImplementedException } from '@nestjs/common';
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
 * Each method is a contract stub — call sites can depend on PostsService
 * while the implementation is filled in later.
 */
@Injectable()
export class PostsService {
  // ---- Read ----------------------------------------------------------------

  listPosts(_query: ListPostsQuery): PostPaginatedList {
    throw new NotImplementedException('PostsService.listPosts');
  }

  getPostDetail(_postId: string): PostDetail {
    throw new NotImplementedException('PostsService.getPostDetail');
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
