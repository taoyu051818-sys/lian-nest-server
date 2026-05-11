import { Controller, Get, Param, Query } from '@nestjs/common';
import { TagsUsecase } from './tags.usecase';
import { TagsResponse, TagTopicsQuery, TagTopicsResponse } from './tags.types';

@Controller('api/tags')
export class TagsController {
  constructor(private readonly tagsUsecase: TagsUsecase) {}

  @Get()
  async list(): Promise<TagsResponse> {
    return this.tagsUsecase.list();
  }

  @Get(':tag/topics')
  async listTopics(
    @Param('tag') tag: string,
    @Query() query: TagTopicsQuery,
  ): Promise<TagTopicsResponse> {
    return this.tagsUsecase.listTopics(tag, query);
  }
}
