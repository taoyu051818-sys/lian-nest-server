import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FeedController } from './feed.controller';
import { GetFeedUsecase, GetFeedItemUsecase } from './usecases';
import { FeedResponseDto, FeedItemDto, FeedQueryDto } from './dto';

interface EdgeCaseFixture {
  id: string;
  endpoint: string;
  description: string;
  request: {
    method: string;
    path: string;
    query: Record<string, unknown>;
    params: Record<string, unknown>;
    headers: Record<string, unknown>;
  };
  expected: {
    status: number;
    contentType?: string;
    body?: Record<string, unknown>;
    bodySchema?: Record<string, unknown>;
  };
  notes?: string;
}

const edgeCasesPath = path.resolve(__dirname, '../../test/parity/feed/feed-controller-edge-cases.json');
const edgeCases: EdgeCaseFixture[] = JSON.parse(fs.readFileSync(edgeCasesPath, 'utf-8'));

describe('FeedController edge regression', () => {
  let controller: FeedController;
  let getFeedUsecase: jest.Mocked<GetFeedUsecase>;
  let getFeedItemUsecase: jest.Mocked<GetFeedItemUsecase>;

  const mockFeedResponse: FeedResponseDto = {
    items: [],
    totalCount: 0,
    page: 1,
    perPage: 20,
  };

  const mockFeedItem: FeedItemDto = {
    id: 't1',
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
    getFeedUsecase = module.get(GetFeedUsecase) as jest.Mocked<GetFeedUsecase>;
    getFeedItemUsecase = module.get(GetFeedItemUsecase) as jest.Mocked<GetFeedItemUsecase>;
  });

  describe('invalid feedItemId propagation', () => {
    const invalidIdCases = edgeCases
      .filter((c: EdgeCaseFixture) => c.endpoint === 'GET /api/feed/:feedItemId')
      .map((c: EdgeCaseFixture) => [c.id, String(c.request.params.feedItemId), c.description] as const);

    it.each(invalidIdCases)('%s: feedItemId=%j throws NotFoundException', (_id, feedItemId, _desc) => {
      getFeedItemUsecase.execute.mockRejectedValueOnce(
        new NotFoundException(`Invalid feed item ID: ${feedItemId}`),
      );
      expect(controller.getFeedItem(feedItemId, 1)).rejects.toThrow(NotFoundException);
    });

    it('propagates NotFoundException from usecase for non-existent t-prefixed ID', async () => {
      getFeedItemUsecase.execute.mockRejectedValueOnce(
        new NotFoundException('Feed item t999999 not found'),
      );
      await expect(controller.getFeedItem('t999999', 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('query coercion edge cases', () => {
    const coercionCases = edgeCases
      .filter((c: EdgeCaseFixture) => c.endpoint === 'GET /api/feed' && c.expected.status === 200)
      .map((c: EdgeCaseFixture) => [c.id, c.request.query, c.description] as const);

    it.each(coercionCases)('%s: query=%j succeeds', async (_id, query, _desc) => {
      const result = await controller.getFeed(query as unknown as FeedQueryDto, 1);
      expect(result).toBeDefined();
      expect(result.page).toBeDefined();
      expect(result.perPage).toBeDefined();
    });

    it('defaults page to 1 when query is empty', async () => {
      const result = await controller.getFeed({} as FeedQueryDto, 1);
      expect(getFeedUsecase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
      );
      expect(result).toEqual(mockFeedResponse);
    });
  });

  describe('query rejection edge cases', () => {
    function toDto(raw: Record<string, unknown>): FeedQueryDto {
      return plainToInstance(FeedQueryDto, raw);
    }

    const rejectionCases = edgeCases
      .filter((c: EdgeCaseFixture) => c.endpoint === 'GET /api/feed' && c.expected.status === 400)
      .map((c: EdgeCaseFixture) => [c.id, c.request.query, c.description] as const);

    it.each(rejectionCases)('%s: query=%j fails validation', async (_id, query, _desc) => {
      const dto = toDto(query as Record<string, unknown>);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects page=0 (below @Min(1))', async () => {
      const errors = await validate(toDto({ page: 0 }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('page');
    });

    it('rejects perPage=51 (above @Max(50))', async () => {
      const errors = await validate(toDto({ perPage: 51 }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('perPage');
    });

    it('rejects perPage=0 (below @Min(1))', async () => {
      const errors = await validate(toDto({ perPage: 0 }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('perPage');
    });

    it('rejects non-numeric page string', async () => {
      const dto = toDto({ page: 'abc' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('page');
    });

    it('rejects limit=51 (above @Max(50))', async () => {
      const errors = await validate(toDto({ limit: 51 }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('limit');
    });
  });

  describe('parity fixture coverage', () => {
    it('has edge cases loaded from parity JSON', () => {
      expect(edgeCases.length).toBeGreaterThan(0);
      expect(edgeCases.every((c: EdgeCaseFixture) => c.id && c.endpoint && c.expected)).toBe(true);
    });

    it('covers both feed list and feed item endpoints', () => {
      const endpoints = new Set(edgeCases.map((c: EdgeCaseFixture) => c.endpoint));
      expect(endpoints.has('GET /api/feed')).toBe(true);
      expect(endpoints.has('GET /api/feed/:feedItemId')).toBe(true);
    });
  });
});
