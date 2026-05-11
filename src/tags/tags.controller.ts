import { Controller, Get } from '@nestjs/common';
import { TagsUsecase } from './tags.usecase';
import { TagsResponse } from './tags.types';

@Controller('api/tags')
export class TagsController {
  constructor(private readonly tagsUsecase: TagsUsecase) {}

  @Get()
  async list(): Promise<TagsResponse> {
    return this.tagsUsecase.list();
  }
}
