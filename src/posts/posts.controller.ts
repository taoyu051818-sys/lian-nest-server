import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, CurrentUser } from '../auth';
import { PostsUsecase } from './posts.service';
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
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsUsecase: PostsUsecase) {}

  // ---- Read ----------------------------------------------------------------

  @Get()
  listPosts(@Query() query: ListPostsQuery): Promise<PostPaginatedList> {
    return this.postsUsecase.listPosts(query);
  }

  @Get(':postId')
  getPostDetail(@Param('postId') postId: string): Promise<PostDetail> {
    return this.postsUsecase.getPostDetail(postId);
  }

  // ---- Write ---------------------------------------------------------------

  @Post()
  createPost(
    @Body() body: CreatePostBody,
    @CurrentUser('sub') userId: number,
  ): PostDetail {
    return this.postsUsecase.createPost(body);
  }

  @Put(':postId')
  updatePost(
    @Param('postId') postId: string,
    @Body() body: UpdatePostBody,
    @CurrentUser('sub') userId: number,
  ): PostDetail {
    return this.postsUsecase.updatePost(postId, body);
  }

  @Delete(':postId')
  deletePost(
    @Param('postId') postId: string,
    @CurrentUser('sub') userId: number,
  ): { deleted: true } {
    return this.postsUsecase.deletePost(postId);
  }

  // ---- Reactions -----------------------------------------------------------

  @Get(':postId/reactions')
  listReactions(
    @Param('postId') postId: string,
  ): Promise<PostReactionSummary[]> {
    return this.postsUsecase.listReactions(postId);
  }

  @Post(':postId/reactions')
  addReaction(
    @Param('postId') postId: string,
    @Body() body: CreateReactionBody,
    @CurrentUser('sub') userId: number,
  ): PostReactionSummary {
    return this.postsUsecase.addReaction(postId, body);
  }

  @Delete(':postId/reactions/:reactionType')
  removeReaction(
    @Param('postId') postId: string,
    @Param('reactionType') reactionType: string,
    @CurrentUser('sub') userId: number,
  ): { removed: true } {
    return this.postsUsecase.removeReaction(postId, reactionType);
  }

  // ---- Replies -------------------------------------------------------------

  @Get(':postId/replies')
  listReplies(
    @Param('postId') postId: string,
    @Query() query: ListRepliesQuery,
  ): Promise<{ items: PostReply[]; totalCount: number; page: number; perPage: number }> {
    return this.postsUsecase.listReplies(postId, query);
  }

  @Post(':postId/replies')
  createReply(
    @Param('postId') postId: string,
    @Body() body: CreateReplyBody,
    @CurrentUser('sub') userId: number,
  ): PostReply {
    return this.postsUsecase.createReply(postId, body);
  }

  @Delete(':postId/replies/:replyId')
  deleteReply(
    @Param('postId') postId: string,
    @Param('replyId') replyId: string,
    @CurrentUser('sub') userId: number,
  ): { deleted: true } {
    return this.postsUsecase.deleteReply(postId, replyId);
  }
}
