import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchUsecase } from './search.usecase';
import { NodebbSearchProvider } from '../nodebb/providers/nodebb-search.provider';

describe('SearchController', () => {
  let controller: SearchController;
  let usecase: SearchUsecase;

  const mockSearchProvider = {
    search: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        SearchUsecase,
        { provide: NodebbSearchProvider, useValue: mockSearchProvider },
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
    usecase = module.get<SearchUsecase>(SearchUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('search', () => {
    it('should delegate to usecase', async () => {
      const mockResult = {
        term: 'test',
        items: [{ id: 1, title: 'Result', snippet: 'content', timestamp: 1700000000 }],
        total: 1,
        page: 1,
        pages: 1,
        source: 'nodebb' as const,
      };
      const spy = jest.spyOn(usecase, 'search').mockResolvedValue(mockResult);
      const result = await controller.search('test', '1');
      expect(spy).toHaveBeenCalledWith('test', '1');
      expect(result).toEqual(mockResult);
    });

    it('should pass undefined page when not provided', async () => {
      const mockResult = {
        term: 'test',
        items: [],
        total: 0,
        page: 1,
        pages: 0,
        source: 'nodebb' as const,
      };
      const spy = jest.spyOn(usecase, 'search').mockResolvedValue(mockResult);
      await controller.search('test');
      expect(spy).toHaveBeenCalledWith('test', undefined);
    });

    it('should propagate BadRequestException for empty term', async () => {
      jest.spyOn(usecase, 'search').mockRejectedValue(
        new BadRequestException('Search term is required'),
      );
      await expect(controller.search('')).rejects.toThrow(BadRequestException);
    });
  });
});
