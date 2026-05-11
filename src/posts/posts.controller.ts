import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { PostsService } from './posts.service';
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

@Controller('api/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  // ---- Read ----------------------------------------------------------------

  @Get()
  listPosts(@Query() query: ListPostsQuery): Promise<PostPaginatedList> {
    return this.postsService.listPosts(query);
  }

  @Get(':postId')
  getPostDetail(@Param('postId') postId: string): Promise<PostDetail> {
    return this.postsService.getPostDetail(postId);
  }

  // ---- Write ---------------------------------------------------------------

  @Post()
  createPost(@Body() body: CreatePostBody): PostDetail {
    return this.postsService.createPost(body);
  }

  @Put(':postId')
  updatePost(
    @Param('postId') postId: string,
    @Body() body: UpdatePostBody,
  ): PostDetail {
    return this.postsService.updatePost(postId, body);
  }

  @Delete(':postId')
  deletePost(@Param('postId') postId: string): { deleted: true } {
    return this.postsService.deletePost(postId);
  }

  // ---- Reactions -----------------------------------------------------------

  @Get(':postId/reactions')
  listReactions(
    @Param('postId') postId: string,
  ): Promise<PostReactionSummary[]> {
    return this.postsService.listReactions(postId);
  }

  @Post(':postId/reactions')
  addReaction(
    @Param('postId') postId: string,
    @Body() body: CreateReactionBody,
  ): PostReactionSummary {
    return this.postsService.addReaction(postId, body);
  }

  @Delete(':postId/reactions/:reactionType')
  removeReaction(
    @Param('postId') postId: string,
    @Param('reactionType') reactionType: string,
  ): { removed: true } {
    return this.postsService.removeReaction(postId, reactionType);
  }

  // ---- Replies -------------------------------------------------------------

  @Get(':postId/replies')
  listReplies(
    @Param('postId') postId: string,
    @Query() query: ListRepliesQuery,
  ): Promise<{ items: PostReply[]; totalCount: number; page: number; perPage: number }> {
    return this.postsService.listReplies(postId, query);
  }

  @Post(':postId/replies')
  createReply(
    @Param('postId') postId: string,
    @Body() body: CreateReplyBody,
  ): PostReply {
    return this.postsService.createReply(postId, body);
  }

  @Delete(':postId/replies/:replyId')
  deleteReply(
    @Param('postId') postId: string,
    @Param('replyId') replyId: string,
  ): { deleted: true } {
    return this.postsService.deleteReply(postId, replyId);
  }
}
