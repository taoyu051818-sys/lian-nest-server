import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SearchUsecase } from './search.usecase';
import { NodebbSearchProvider } from '../nodebb/providers/nodebb-search.provider';
import { BodyStatus } from '../nodebb/types';

describe('SearchUsecase', () => {
  let usecase: SearchUsecase;

  const mockSearchProvider = {
    search: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchUsecase,
        { provide: NodebbSearchProvider, useValue: mockSearchProvider },
      ],
    }).compile();

    usecase = module.get<SearchUsecase>(SearchUsecase);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(usecase).toBeDefined();
  });

  describe('search', () => {
    const mockNodebbResponse = {
      matches: [
        { id: 1, title: 'Test Result', content: 'Some content here', timestamp: 1700000000 },
        { id: 2, title: 'Another Result', content: 'More content', timestamp: 1700000100 },
      ],
      matchCount: 2,
      pagination: { page: 1, pageCount: 1, itemsPerPage: 20 },
    };

    it('should map NodeBB search response to SearchResponse', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbResponse, error: null,
      });
      const result = await usecase.search('test');
      expect(result).toEqual({
        term: 'test',
        items: [
          { id: 1, title: 'Test Result', snippet: 'Some content here', timestamp: 1700000000 },
          { id: 2, title: 'Another Result', snippet: 'More content', timestamp: 1700000100 },
        ],
        total: 2,
        page: 1,
        pages: 1,
        source: 'nodebb',
      });
      expect(mockSearchProvider.search).toHaveBeenCalledWith('test', { page: 1 });
    });

    it('should trim the search term', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbResponse, error: null,
      });
      await usecase.search('  hello world  ');
      expect(mockSearchProvider.search).toHaveBeenCalledWith('hello world', { page: 1 });
    });

    it('should pass page parameter to provider', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbResponse, error: null,
      });
      await usecase.search('test', '2');
      expect(mockSearchProvider.search).toHaveBeenCalledWith('test', { page: 2 });
    });

    it('should default page to 1 when not provided', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbResponse, error: null,
      });
      await usecase.search('test');
      expect(mockSearchProvider.search).toHaveBeenCalledWith('test', { page: 1 });
    });

    it('should handle empty matches', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: { matches: [], matchCount: 0, pagination: { page: 1, pageCount: 0, itemsPerPage: 20 } },
        error: null,
      });
      const result = await usecase.search('noresults');
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle null matches gracefully', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: { matches: null, matchCount: null, pagination: null },
        error: null,
      });
      const result = await usecase.search('test');
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should throw BadRequestException for empty term', async () => {
      await expect(usecase.search('')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for whitespace-only term', async () => {
      await expect(usecase.search('   ')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid page', async () => {
      await expect(usecase.search('test', 'abc')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for zero page', async () => {
      await expect(usecase.search('test', '0')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for negative page', async () => {
      await expect(usecase.search('test', '-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when provider returns error', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.ERROR, statusCode: 500,
        data: null, error: 'Internal error',
      });
      await expect(usecase.search('test')).rejects.toThrow(BadRequestException);
    });

    // --- Response shape validation ---

    it('should return a response with only SearchResponse keys', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbResponse, error: null,
      });
      const result = await usecase.search('test');
      expect(Object.keys(result).sort()).toEqual(['items', 'page', 'pages', 'source', 'term', 'total']);
    });

    it('should return items with only SearchResultItem keys', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbResponse, error: null,
      });
      const result = await usecase.search('test');
      for (const item of result.items) {
        expect(Object.keys(item).sort()).toEqual(['id', 'snippet', 'timestamp', 'title']);
      }
    });

    it('should default page to 1 and pages to 1 when pagination is null', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: { matches: [], matchCount: 0, pagination: null },
        error: null,
      });
      const result = await usecase.search('test');
      expect(result.page).toBe(1);
      expect(result.pages).toBe(1);
    });

    it('should default pages to 1 when pagination is undefined', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: { matches: [], matchCount: 0, pagination: undefined },
        error: null,
      });
      const result = await usecase.search('test');
      expect(result.page).toBe(1);
      expect(result.pages).toBe(1);
    });

    it('should return source as "nodebb"', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbResponse, error: null,
      });
      const result = await usecase.search('test');
      expect(result.source).toBe('nodebb');
    });

    // --- Page coercion edge cases ---

    it('should throw BadRequestException for floating-point page', async () => {
      await expect(usecase.search('test', '1.5')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for NaN page', async () => {
      await expect(usecase.search('test', 'NaN')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for Infinity page', async () => {
      await expect(usecase.search('test', 'Infinity')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty string page', async () => {
      await expect(usecase.search('test', '')).rejects.toThrow(BadRequestException);
    });

    it('should use page 1 when page is undefined', async () => {
      mockSearchProvider.search.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbResponse, error: null,
      });
      await usecase.search('test');
      expect(mockSearchProvider.search).toHaveBeenCalledWith('test', { page: 1 });
    });
  });
});
