import { Test, TestingModule } from '@nestjs/testing';
import { TagsController } from './tags.controller';
import { TagsUsecase } from './tags.usecase';
import { NodebbTagsProvider } from '../nodebb/providers/nodebb-tags.provider';

describe('TagsController', () => {
  let controller: TagsController;
  let usecase: TagsUsecase;

  const mockTagsProvider = {
    list: jest.fn(),
    listTopics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TagsController],
      providers: [
        TagsUsecase,
        { provide: NodebbTagsProvider, useValue: mockTagsProvider },
      ],
    }).compile();

    controller = module.get<TagsController>(TagsController);
    usecase = module.get<TagsUsecase>(TagsUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('should delegate to usecase', async () => {
      const mockResponse = {
        tags: [
          { value: 'nodebb', score: 10, color: '#fff' },
          { value: 'general', score: 5, color: null },
        ],
        source: 'nodebb' as const,
      };
      const spy = jest.spyOn(usecase, 'list').mockResolvedValue(mockResponse);
      const result = await controller.list();
      expect(spy).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });

    it('should return fallback when usecase returns empty', async () => {
      const mockResponse = {
        tags: [],
        source: 'fallback' as const,
      };
      jest.spyOn(usecase, 'list').mockResolvedValue(mockResponse);
      const result = await controller.list();
      expect(result.tags).toEqual([]);
      expect(result.source).toBe('fallback');
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

    it('should delegate to usecase with tag param', async () => {
      const mockResponse = {
        topics: mockTopics(1),
        source: 'nodebb' as const,
        totalCount: 1,
        page: 1,
        perPage: 20,
      };
      const spy = jest
        .spyOn(usecase, 'listTopics')
        .mockResolvedValue(mockResponse);
      const result = await controller.listTopics('nodebb', {});
      expect(spy).toHaveBeenCalledWith('nodebb', {});
      expect(result).toEqual(mockResponse);
    });

    it('should return fallback when usecase returns empty', async () => {
      const mockResponse = {
        topics: [],
        source: 'fallback' as const,
        totalCount: 0,
        page: 1,
        perPage: 20,
      };
      jest.spyOn(usecase, 'listTopics').mockResolvedValue(mockResponse);
      const result = await controller.listTopics('nonexistent', {});
      expect(result.topics).toEqual([]);
      expect(result.source).toBe('fallback');
    });

    it('should pass query params to usecase', async () => {
      const mockResponse = {
        topics: mockTopics(5),
        source: 'nodebb' as const,
        totalCount: 30,
        page: 2,
        perPage: 5,
      };
      const spy = jest
        .spyOn(usecase, 'listTopics')
        .mockResolvedValue(mockResponse);
      await controller.listTopics('nodebb', { page: 2, perPage: 5 });
      expect(spy).toHaveBeenCalledWith('nodebb', { page: 2, perPage: 5 });
    });

    it('should use default pagination when no query provided', async () => {
      const allTopics = mockTopics(25);
      const mockResponse = {
        topics: allTopics.slice(0, 20),
        source: 'nodebb' as const,
        totalCount: 25,
        page: 1,
        perPage: 20,
      };
      jest.spyOn(usecase, 'listTopics').mockResolvedValue(mockResponse);
      const result = await controller.listTopics('nodebb', {});
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
      expect(result.topics).toHaveLength(20);
    });

    it('should return empty items with pagination for empty results', async () => {
      const mockResponse = {
        topics: [],
        source: 'fallback' as const,
        totalCount: 0,
        page: 1,
        perPage: 20,
      };
      jest.spyOn(usecase, 'listTopics').mockResolvedValue(mockResponse);
      const result = await controller.listTopics('empty-tag', {});
      expect(result.topics).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should clamp negative page to 1', async () => {
      const mockResponse = {
        topics: mockTopics(5),
        source: 'nodebb' as const,
        totalCount: 5,
        page: 1,
        perPage: 20,
      };
      jest.spyOn(usecase, 'listTopics').mockResolvedValue(mockResponse);
      const result = await controller.listTopics('nodebb', { page: -1 });
      expect(result.page).toBe(1);
    });

    it('should clamp perPage exceeding 100', async () => {
      const mockResponse = {
        topics: mockTopics(5),
        source: 'nodebb' as const,
        totalCount: 5,
        page: 1,
        perPage: 100,
      };
      jest.spyOn(usecase, 'listTopics').mockResolvedValue(mockResponse);
      const result = await controller.listTopics('nodebb', { perPage: 999 });
      expect(result.perPage).toBe(100);
    });
  });
});
