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
    it('should delegate to usecase with tag param', async () => {
      const mockResponse = {
        topics: [
          {
            tid: 1,
            uid: 2,
            cid: 3,
            title: 'Test Topic',
            slug: 'test-topic',
            mainPid: 10,
            postcount: 5,
            viewcount: 100,
            timestamp: 1700000000,
          },
        ],
        source: 'nodebb' as const,
      };
      const spy = jest
        .spyOn(usecase, 'listTopics')
        .mockResolvedValue(mockResponse);
      const result = await controller.listTopics('nodebb');
      expect(spy).toHaveBeenCalledWith('nodebb');
      expect(result).toEqual(mockResponse);
    });

    it('should return fallback when usecase returns empty', async () => {
      const mockResponse = {
        topics: [],
        source: 'fallback' as const,
      };
      jest.spyOn(usecase, 'listTopics').mockResolvedValue(mockResponse);
      const result = await controller.listTopics('nonexistent');
      expect(result.topics).toEqual([]);
      expect(result.source).toBe('fallback');
    });
  });
});
