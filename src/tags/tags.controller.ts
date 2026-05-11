import { Controller, Get, Param } from '@nestjs/common';
import { TagsUsecase } from './tags.usecase';
import { TagsResponse, TagTopicsResponse } from './tags.types';

@Controller('api/tags')
export class TagsController {
  constructor(private readonly tagsUsecase: TagsUsecase) {}

  @Get()
  async list(): Promise<TagsResponse> {
    return this.tagsUsecase.list();
  }

  @Get(':tag/topics')
  async listTopics(@Param('tag') tag: string): Promise<TagTopicsResponse> {
    return this.tagsUsecase.listTopics(tag);
  }
}
