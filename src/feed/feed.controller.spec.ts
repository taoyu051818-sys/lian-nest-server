import { Test, TestingModule } from '@nestjs/testing';
import { FeedController } from './feed.controller';
import { GetFeedUsecase, GetFeedItemUsecase } from './usecases';
import { FeedResponseDto, FeedItemDto } from './dto';

describe('FeedController', () => {
  let controller: FeedController;
  let getFeedUsecase: GetFeedUsecase;
  let getFeedItemUsecase: GetFeedItemUsecase;

  const mockFeedResponse: FeedResponseDto = {
    items: [],
    totalCount: 0,
    page: 1,
    perPage: 20,
  };

  const mockFeedItem: FeedItemDto = {
    id: 'item-1',
    postId: 1,
    topicId: 1,
    title: 'Test Post',
    snippet: 'Hello world',
    authorUid: 1,
    authorUsername: 'testuser',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedController],
      providers: [
        {
          provide: GetFeedUsecase,
          useValue: { execute: jest.fn().mockResolvedValue(mockFeedResponse) },
        },
        {
          provide: GetFeedItemUsecase,
          useValue: { execute: jest.fn().mockResolvedValue(mockFeedItem) },
        },
      ],
    }).compile();

    controller = module.get<FeedController>(FeedController);
    getFeedUsecase = module.get<GetFeedUsecase>(GetFeedUsecase);
    getFeedItemUsecase = module.get<GetFeedItemUsecase>(GetFeedItemUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFeed', () => {
    it('should delegate to GetFeedUsecase', async () => {
      const result = await controller.getFeed({ page: 1, perPage: 20 });
      expect(getFeedUsecase.execute).toHaveBeenCalledWith({
        page: 1,
        perPage: 20,
        userId: 0,
      });
      expect(result).toEqual(mockFeedResponse);
    });
  });

  describe('getFeedItem', () => {
    it('should delegate to GetFeedItemUsecase', async () => {
      const result = await controller.getFeedItem('item-1');
      expect(getFeedItemUsecase.execute).toHaveBeenCalledWith({
        feedItemId: 'item-1',
        userId: 0,
      });
      expect(result).toEqual(mockFeedItem);
    });
  });
});
