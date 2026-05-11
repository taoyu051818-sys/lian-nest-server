import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { GetFeedUsecase, GetFeedItemUsecase } from './usecases';

@Module({
  controllers: [FeedController],
  providers: [GetFeedUsecase, GetFeedItemUsecase],
})
export class FeedModule {}
