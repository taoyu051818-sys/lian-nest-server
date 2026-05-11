import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  NotImplementedException,
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
  createPost(@Body() _body: CreatePostBody): PostDetail {
    throw new NotImplementedException('PostsController.createPost');
  }

  @Put(':postId')
  updatePost(
    @Param('postId') _postId: string,
    @Body() _body: UpdatePostBody,
  ): PostDetail {
    throw new NotImplementedException('PostsController.updatePost');
  }

  @Delete(':postId')
  deletePost(@Param('postId') _postId: string): { deleted: true } {
    throw new NotImplementedException('PostsController.deletePost');
  }

  // ---- Reactions -----------------------------------------------------------

  @Get(':postId/reactions')
  listReactions(
    @Param('postId') _postId: string,
  ): PostReactionSummary[] {
    throw new NotImplementedException('PostsController.listReactions');
  }

  @Post(':postId/reactions')
  addReaction(
    @Param('postId') _postId: string,
    @Body() _body: CreateReactionBody,
  ): PostReactionSummary {
    throw new NotImplementedException('PostsController.addReaction');
  }

  @Delete(':postId/reactions/:reactionType')
  removeReaction(
    @Param('postId') _postId: string,
    @Param('reactionType') _reactionType: string,
  ): { removed: true } {
    throw new NotImplementedException('PostsController.removeReaction');
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
    @Param('postId') _postId: string,
    @Body() _body: CreateReplyBody,
  ): PostReply {
    throw new NotImplementedException('PostsController.createReply');
  }

  @Delete(':postId/replies/:replyId')
  deleteReply(
    @Param('postId') _postId: string,
    @Param('replyId') _replyId: string,
  ): { deleted: true } {
    throw new NotImplementedException('PostsController.deleteReply');
  }
}
