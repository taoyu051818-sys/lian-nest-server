import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesUsecase } from './categories.usecase';
import { NodebbCategoriesProvider } from '../nodebb/providers/nodebb-categories.provider';

describe('CategoriesController', () => {
  let controller: CategoriesController;
  let usecase: CategoriesUsecase;

  const mockCategoriesProvider = {
    list: jest.fn(),
    getById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        CategoriesUsecase,
        { provide: NodebbCategoriesProvider, useValue: mockCategoriesProvider },
      ],
    }).compile();

    controller = module.get<CategoriesController>(CategoriesController);
    usecase = module.get<CategoriesUsecase>(CategoriesUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('should delegate to usecase', async () => {
      const mockResponse = {
        categories: [
          {
            cid: 1,
            name: 'General',
            slug: 'general',
            description: 'General discussion',
            icon: 'fa-comments',
            color: '#000',
            bgColor: '#fff',
            topicCount: 10,
            postCount: 50,
          },
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
        categories: [],
        source: 'fallback' as const,
      };
      jest.spyOn(usecase, 'list').mockResolvedValue(mockResponse);
      const result = await controller.list();
      expect(result.categories).toEqual([]);
      expect(result.source).toBe('fallback');
    });
  });

  describe('getById', () => {
    it('should delegate to usecase', async () => {
      const mockCategory = {
        cid: 1,
        name: 'General',
        slug: 'general',
        description: 'General discussion',
        icon: 'fa-comments',
        color: '#000',
        bgColor: '#fff',
        topicCount: 10,
        postCount: 50,
      };
      const spy = jest.spyOn(usecase, 'getById').mockResolvedValue(mockCategory);
      const result = await controller.getById('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockCategory);
    });

    it('should propagate NotFoundException for invalid cid', async () => {
      jest.spyOn(usecase, 'getById').mockRejectedValue(
        new NotFoundException('Category abc not found'),
      );
      await expect(controller.getById('abc')).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException for non-existent category', async () => {
      jest.spyOn(usecase, 'getById').mockRejectedValue(
        new NotFoundException('Category 999 not found'),
      );
      await expect(controller.getById('999')).rejects.toThrow(NotFoundException);
    });
  });
});
