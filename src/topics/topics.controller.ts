import { Controller, Get, Param } from '@nestjs/common';
import { TopicsUsecase } from './topics.usecase';
import { TopicDetail } from './types';

@Controller('api/topic')
export class TopicsController {
  constructor(private readonly topicsUsecase: TopicsUsecase) {}

  @Get(':tid')
  async getByTid(@Param('tid') tid: string): Promise<TopicDetail> {
    return this.topicsUsecase.getByTid(tid);
  }
}
