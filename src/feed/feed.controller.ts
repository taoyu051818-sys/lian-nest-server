import { Controller, Get, Param, Query } from '@nestjs/common';
import { FeedQueryDto, FeedItemDto, FeedResponseDto } from './dto';
import { GetFeedUsecase, GetFeedItemUsecase } from './usecases';

@Controller('api/feed')
export class FeedController {
  constructor(
    private readonly getFeedUsecase: GetFeedUsecase,
    private readonly getFeedItemUsecase: GetFeedItemUsecase,
  ) {}

  @Get()
  async getFeed(@Query() query: FeedQueryDto): Promise<FeedResponseDto> {
    // TODO(#33): Extract userId from authenticated request (JwtAuthGuard).
    const userId = 0;
    return this.getFeedUsecase.execute({ ...query, userId });
  }

  @Get(':feedItemId')
  async getFeedItem(@Param('feedItemId') feedItemId: string): Promise<FeedItemDto> {
    // TODO(#33): Extract userId from authenticated request (JwtAuthGuard).
    const userId = 0;
    return this.getFeedItemUsecase.execute({ feedItemId, userId });
  }
}
