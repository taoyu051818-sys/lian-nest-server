import { Injectable } from '@nestjs/common';
import { FeedItemDto } from '../dto';

export interface GetFeedItemInput {
  feedItemId: string;
  userId: number;
}

@Injectable()
export class GetFeedItemUsecase {
  async execute(_input: GetFeedItemInput): Promise<FeedItemDto> {
    // TODO(#33): Implement single feed item retrieval.
    // Steps:
    //   1. Look up post metadata by feedItemId.
    //   2. Verify the item is in the user's feed scope.
    //   3. Enrich with author and topic data.
    //   4. Return FeedItemDto.
    throw new Error('GetFeedItemUsecase not implemented');
  }
}
