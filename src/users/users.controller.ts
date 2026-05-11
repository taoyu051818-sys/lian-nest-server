import { Controller, Get, Param, Query } from '@nestjs/common';
import { UsersUsecase } from './users.usecase';
import { PostsPaginationQuery, UserDetail, UserPostsResponse } from './types';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersUsecase: UsersUsecase) {}

  @Get(':uid')
  async getByUid(@Param('uid') uid: string): Promise<UserDetail> {
    return this.usersUsecase.getByUid(uid);
  }

  @Get(':uid/posts')
  async getPosts(
    @Param('uid') uid: string,
    @Query() query: PostsPaginationQuery,
  ): Promise<UserPostsResponse> {
    return this.usersUsecase.getPosts(uid, query);
  }
}
