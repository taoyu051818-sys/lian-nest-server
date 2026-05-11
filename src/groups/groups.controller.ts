import { Controller, Get } from '@nestjs/common';
import { GroupsUsecase } from './groups.usecase';
import { GroupsResponse } from './groups.types';

@Controller('api/groups')
export class GroupsController {
  constructor(private readonly groupsUsecase: GroupsUsecase) {}

  @Get()
  async list(): Promise<GroupsResponse> {
    return this.groupsUsecase.list();
  }
}
