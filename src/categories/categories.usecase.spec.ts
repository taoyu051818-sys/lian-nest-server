import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CategoriesUsecase } from './categories.usecase';
import { NodebbCategoriesProvider } from '../nodebb/providers/nodebb-categories.provider';
import { BodyStatus } from '../nodebb/types';

describe('CategoriesUsecase', () => {
  let usecase: CategoriesUsecase;
  let provider: NodebbCategoriesProvider;

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
    provider = module.get<NodebbCategoriesProvider>(NodebbCategoriesProvider);
  });

  afterEach(() => jest.resetAllMocks());

  describe('getById – parameter coercion', () => {
    it('should reject non-numeric string', async () => {
      await expect(usecase.getById('abc')).rejects.toThrow(NotFoundException);
      expect(mockProvider.getById).not.toHaveBeenCalled();
    });

    it('should reject empty string', async () => {
      await expect(usecase.getById('')).rejects.toThrow(NotFoundException);
      expect(mockProvider.getById).not.toHaveBeenCalled();
    });

    it('should reject cid=0', async () => {
      await expect(usecase.getById('0')).rejects.toThrow(NotFoundException);
      expect(mockProvider.getById).not.toHaveBeenCalled();
    });

    it('should reject negative cid', async () => {
      await expect(usecase.getById('-1')).rejects.toThrow(NotFoundException);
      expect(mockProvider.getById).not.toHaveBeenCalled();
    });

    it('should reject fractional cid', async () => {
      await expect(usecase.getById('1.5')).rejects.toThrow(NotFoundException);
      expect(mockProvider.getById).not.toHaveBeenCalled();
    });

    it('should reject Infinity', async () => {
      await expect(usecase.getById('Infinity')).rejects.toThrow(NotFoundException);
      expect(mockProvider.getById).not.toHaveBeenCalled();
    });

    it('should reject NaN-producing string', async () => {
      await expect(usecase.getById('NaN')).rejects.toThrow(NotFoundException);
      expect(mockProvider.getById).not.toHaveBeenCalled();
    });

    it('should accept valid integer cid and delegate to provider', async () => {
      const mockCat = {
        cid: 1,
        name: 'General',
        slug: 'general',
        description: '',
        icon: '',
        color: '',
        bgColor: '',
        topic_count: 0,
        post_count: 0,
      };
      mockProvider.getById.mockResolvedValue({
        status: BodyStatus.OK,
        data: mockCat,
      });

      const result = await usecase.getById('1');
      expect(mockProvider.getById).toHaveBeenCalledWith(1);
      expect(result.cid).toBe(1);
    });

    it('should throw NotFoundException when provider returns NOT_FOUND', async () => {
      mockProvider.getById.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        data: null,
      });

      await expect(usecase.getById('999')).rejects.toThrow(NotFoundException);
    });
  });
});
