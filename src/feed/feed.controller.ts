import { Controller, Get, Param, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard, CurrentUser } from '../auth';
import { FeedQueryDto, FeedItemDto, FeedResponseDto } from './dto';
import { GetFeedUsecase, GetFeedItemUsecase } from './usecases';

@Controller('api/feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(
    private readonly getFeedUsecase: GetFeedUsecase,
    private readonly getFeedItemUsecase: GetFeedItemUsecase,
  ) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getFeed(@Query() query: FeedQueryDto, @CurrentUser('sub') userId: number): Promise<FeedResponseDto> {
    return this.getFeedUsecase.execute({ ...query, userId });
  }

  @Get(':feedItemId')
  async getFeedItem(@Param('feedItemId') feedItemId: string, @CurrentUser('sub') userId: number): Promise<FeedItemDto> {
    return this.getFeedItemUsecase.execute({ feedItemId, userId });
  }
}
