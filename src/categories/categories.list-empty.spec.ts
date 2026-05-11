import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesUsecase } from './categories.usecase';
import { NodebbCategoriesProvider } from '../nodebb/providers/nodebb-categories.provider';
import { BodyStatus } from '../nodebb/types';

describe('CategoriesUsecase – list empty response', () => {
  let usecase: CategoriesUsecase;

  const mockProvider = {
    list: jest.fn(),
    getById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesUsecase,
        { provide: NodebbCategoriesProvider, useValue: mockProvider },
      ],
    }).compile();

    usecase = module.get<CategoriesUsecase>(CategoriesUsecase);
  });

  afterEach(() => jest.resetAllMocks());

  describe('provider returns error status', () => {
    it('should return empty categories with fallback source on ERROR', async () => {
      mockProvider.list.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 502,
        data: null,
      });

      const result = await usecase.list();
      expect(result).toEqual({ categories: [], source: 'fallback' });
    });

    it('should return empty categories with fallback source on NOT_FOUND', async () => {
      mockProvider.list.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
      });

      const result = await usecase.list();
      expect(result).toEqual({ categories: [], source: 'fallback' });
    });
  });

  describe('provider returns OK with null/undefined data', () => {
    it('should return empty categories with fallback source when data is null', async () => {
      mockProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
      });

      const result = await usecase.list();
      expect(result).toEqual({ categories: [], source: 'fallback' });
    });

    it('should return empty categories with fallback source when data is undefined', async () => {
      mockProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: undefined,
      });

      const result = await usecase.list();
      expect(result).toEqual({ categories: [], source: 'fallback' });
    });
  });

  describe('provider returns OK with empty array', () => {
    it('should return empty categories with nodebb source', async () => {
      mockProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
      });

      const result = await usecase.list();
      expect(result).toEqual({ categories: [], source: 'nodebb' });
    });
  });

  describe('provider returns OK with all disabled categories', () => {
    it('should return empty categories with nodebb source when all are disabled', async () => {
      mockProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          {
            cid: 1,
            name: 'Disabled',
            slug: 'disabled',
            description: '',
            icon: '',
            color: '',
            bgColor: '',
            topic_count: 0,
            post_count: 0,
            disabled: true,
          },
        ],
      });

      const result = await usecase.list();
      expect(result.categories).toEqual([]);
      expect(result.source).toBe('nodebb');
    });
  });

  describe('response shape stability', () => {
    it('should always return object with categories array and source string', async () => {
      mockProvider.list.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
      });

      const result = await usecase.list();
      expect(Array.isArray(result.categories)).toBe(true);
      expect(typeof result.source).toBe('string');
      expect(['nodebb', 'fallback']).toContain(result.source);
    });
  });
});
