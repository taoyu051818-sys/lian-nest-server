import { Test, TestingModule } from '@nestjs/testing';
import { TagsController } from './tags.controller';
import { TagsUsecase } from './tags.usecase';
import { NodebbTagsProvider } from '../nodebb/providers/nodebb-tags.provider';

describe('TagsController', () => {
  let controller: TagsController;
  let usecase: TagsUsecase;

  const mockTagsProvider = {
    list: jest.fn(),
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
});
