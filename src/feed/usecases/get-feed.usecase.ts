import { Injectable } from '@nestjs/common';
import { FeedQueryDto, FeedResponseDto } from '../dto';

export interface GetFeedInput extends FeedQueryDto {
  userId: number;
}

@Injectable()
export class GetFeedUsecase {
  async execute(_input: GetFeedInput): Promise<FeedResponseDto> {
    // TODO(#33): Implement feed retrieval via repository.
    // Steps:
    //   1. Resolve followed channels/users for the requesting user.
    //   2. Query post metadata repository for recent posts.
    //   3. Enrich with author info (NodebbUsersProvider or cache).
    //   4. Paginate and return.
    throw new Error('GetFeedUsecase not implemented');
  }
}
