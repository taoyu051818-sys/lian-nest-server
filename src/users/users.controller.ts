import { Controller, Get, Param } from '@nestjs/common';
import { UsersUsecase } from './users.usecase';
import { UserDetail } from './types';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersUsecase: UsersUsecase) {}

  @Get(':uid')
  async getByUid(@Param('uid') uid: string): Promise<UserDetail> {
    return this.usersUsecase.getByUid(uid);
  }
}
