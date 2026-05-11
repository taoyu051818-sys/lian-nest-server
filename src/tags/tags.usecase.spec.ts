import { Test, TestingModule } from '@nestjs/testing';
import { TagsUsecase } from './tags.usecase';
import { NodebbTagsProvider } from '../nodebb/providers/nodebb-tags.provider';
import { BodyStatus } from '../nodebb/types';

describe('TagsUsecase', () => {
  let usecase: TagsUsecase;
  let provider: jest.Mocked<NodebbTagsProvider>;

  const mockProvider = {
    list: jest.fn(),
    listTopics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsUsecase,
        { provide: NodebbTagsProvider, useValue: mockProvider },
      ],
    }).compile();

    usecase = module.get<TagsUsecase>(TagsUsecase);
    provider = mockProvider as unknown as jest.Mocked<NodebbTagsProvider>;
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should map nodebb tags to TagItem[] with source=nodebb', async () => {
      provider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { value: 'nodebb', score: 10, color: '#fff' },
          { value: 'general', score: 5 },
        ],
        error: null,
      });

      const result = await usecase.list();

      expect(result.source).toBe('nodebb');
      expect(result.tags).toHaveLength(2);
      expect(result.tags[0]).toEqual({ value: 'nodebb', score: 10, color: '#fff' });
      expect(result.tags[1]).toEqual({ value: 'general', score: 5, color: null });
    });

    it('should return fallback when provider returns error status', async () => {
      provider.list.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'upstream failure',
      });

      const result = await usecase.list();

      expect(result.source).toBe('fallback');
      expect(result.tags).toEqual([]);
    });

    it('should return fallback when provider returns not_found status', async () => {
      provider.list.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      const result = await usecase.list();

      expect(result.source).toBe('fallback');
      expect(result.tags).toEqual([]);
    });

    it('should return fallback when provider returns OK status but null data', async () => {
      provider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });

      const result = await usecase.list();

      expect(result.source).toBe('fallback');
      expect(result.tags).toEqual([]);
    });
  });

  describe('listTopics', () => {
    const mockTopics = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        tid: i + 1,
        uid: 2,
        cid: 3,
        title: `Topic ${i + 1}`,
        slug: `topic-${i + 1}`,
        mainPid: (i + 1) * 10,
        postcount: 5,
        viewcount: 100,
        timestamp: 1700000000 + i,
      }));

    it('should pass tag directly to provider (encoded tag regression)', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      await usecase.listTopics('c++', {});

      expect(provider.listTopics).toHaveBeenCalledWith('c++');
    });

    it('should pass URL-encoded tag to provider', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      await usecase.listTopics('hello world', {});

      expect(provider.listTopics).toHaveBeenCalledWith('hello world');
    });

    it('should pass tag with special characters to provider', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      await usecase.listTopics('c#/.net', {});

      expect(provider.listTopics).toHaveBeenCalledWith('c#/.net');
    });

    it('should map provider topics to TagTopicItem[] with source=nodebb', async () => {
      const topics = mockTopics(3);
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics },
        error: null,
      });

      const result = await usecase.listTopics('nodebb', {});

      expect(result.source).toBe('nodebb');
      expect(result.topics).toHaveLength(3);
      expect(result.topics[0]).toEqual(topics[0]);
      expect(result.totalCount).toBe(3);
    });

    it('should return fallback when provider returns error status', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'upstream failure',
      });

      const result = await usecase.listTopics('nodebb', {});

      expect(result.source).toBe('fallback');
      expect(result.topics).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should return fallback when provider returns not_found status', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      const result = await usecase.listTopics('missing-tag', {});

      expect(result.source).toBe('fallback');
      expect(result.topics).toEqual([]);
    });

    it('should return fallback when provider returns OK but null data', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });

      const result = await usecase.listTopics('tag', {});

      expect(result.source).toBe('fallback');
      expect(result.topics).toEqual([]);
    });

    it('should paginate results correctly', async () => {
      const topics = mockTopics(25);
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics },
        error: null,
      });

      const result = await usecase.listTopics('nodebb', { page: 2, perPage: 5 });

      expect(result.page).toBe(2);
      expect(result.perPage).toBe(5);
      expect(result.totalCount).toBe(25);
      expect(result.topics).toHaveLength(5);
      expect(result.topics[0].tid).toBe(6);
    });

    it('should clamp negative page to 1', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: mockTopics(5) },
        error: null,
      });

      const result = await usecase.listTopics('nodebb', { page: -1 });

      expect(result.page).toBe(1);
    });

    it('should clamp perPage exceeding 100', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: mockTopics(5) },
        error: null,
      });

      const result = await usecase.listTopics('nodebb', { perPage: 999 });

      expect(result.perPage).toBe(100);
    });

    it('should default page=1 and perPage=20 for non-numeric values', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: mockTopics(5) },
        error: null,
      });

      const result = await usecase.listTopics('nodebb', {
        page: undefined,
        perPage: undefined,
      });

      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should return empty topics slice when page exceeds total', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: mockTopics(3) },
        error: null,
      });

      const result = await usecase.listTopics('nodebb', { page: 10, perPage: 20 });

      expect(result.topics).toEqual([]);
      expect(result.totalCount).toBe(3);
      expect(result.page).toBe(10);
    });

    it('should handle provider returning error for encoded tag names', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'bad request',
      });

      const result = await usecase.listTopics('c++', {});

      expect(result.source).toBe('fallback');
      expect(result.topics).toEqual([]);
    });

    it('should use default query when no query provided', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: mockTopics(3) },
        error: null,
      });

      const result = await usecase.listTopics('tag');

      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });
  });
});
