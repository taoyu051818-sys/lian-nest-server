import { Test, TestingModule } from '@nestjs/testing';
import { ProfileController } from './profile.controller';
import { ProfileUsecase } from './profile.usecase';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';

describe('ProfileController', () => {
  let controller: ProfileController;
  let usecase: ProfileUsecase;

  const mockUsersProvider = {
    getByUid: jest.fn(),
    getBySlug: jest.fn(),
    getSaved: jest.fn(),
    getLiked: jest.fn(),
    getHistory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        ProfileUsecase,
        { provide: NodebbUsersProvider, useValue: mockUsersProvider },
      ],
    }).compile();

    controller = module.get<ProfileController>(ProfileController);
    usecase = module.get<ProfileUsecase>(ProfileUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPublicProfile', () => {
    it('should delegate to usecase', async () => {
      const spy = jest.spyOn(usecase, 'getPublicProfile').mockResolvedValue({
        uid: '1',
        username: 'testuser',
        displayName: 'testuser',
        avatar: null,
        bio: null,
        postCount: 0,
        reputation: 0,
        joinedAt: '2026-01-01T00:00:00.000Z',
      });
      const result = await controller.getPublicProfile('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result.uid).toBe('1');
    });
  });

  describe('getSaved', () => {
    it('should delegate to usecase with query params', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getSaved')
        .mockResolvedValue(mockResponse);
      const result = await controller.getSaved('1', {}, 1);
      expect(spy).toHaveBeenCalledWith('1', {});
      expect(result).toEqual(mockResponse);
    });

    it('should forward page and pageSize from query', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getSaved')
        .mockResolvedValue(mockResponse);
      const result = await controller.getSaved('1', { page: 2, pageSize: 5 }, 1);
      expect(spy).toHaveBeenCalledWith('1', { page: 2, pageSize: 5 });
      expect(result).toEqual(mockResponse);
    });

    it('should forward string page and pageSize from @Query()', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getSaved')
        .mockResolvedValue(mockResponse);
      const result = await controller.getSaved('1', { page: '2', pageSize: '5' }, 1);
      expect(spy).toHaveBeenCalledWith('1', { page: '2', pageSize: '5' });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getLiked', () => {
    it('should delegate to usecase with query params', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getLiked')
        .mockResolvedValue(mockResponse);
      const result = await controller.getLiked('1', {}, 1);
      expect(spy).toHaveBeenCalledWith('1', {});
      expect(result).toEqual(mockResponse);
    });

    it('should forward page and pageSize from query', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getLiked')
        .mockResolvedValue(mockResponse);
      const result = await controller.getLiked('1', { page: 2, pageSize: 5 }, 1);
      expect(spy).toHaveBeenCalledWith('1', { page: 2, pageSize: 5 });
      expect(result).toEqual(mockResponse);
    });

    it('should forward string page and pageSize from @Query()', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getLiked')
        .mockResolvedValue(mockResponse);
      const result = await controller.getLiked('1', { page: '2', pageSize: '5' }, 1);
      expect(spy).toHaveBeenCalledWith('1', { page: '2', pageSize: '5' });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getHistory', () => {
    it('should delegate to usecase with query params', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getHistory')
        .mockResolvedValue(mockResponse);
      const result = await controller.getHistory('1', {}, 1);
      expect(spy).toHaveBeenCalledWith('1', {});
      expect(result).toEqual(mockResponse);
    });

    it('should forward page and pageSize from query', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getHistory')
        .mockResolvedValue(mockResponse);
      const result = await controller.getHistory('1', { page: 2, pageSize: 5 }, 1);
      expect(spy).toHaveBeenCalledWith('1', { page: 2, pageSize: 5 });
      expect(result).toEqual(mockResponse);
    });

    it('should forward string page and pageSize from @Query()', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        source: 'fallback' as const,
      };
      const spy = jest
        .spyOn(usecase, 'getHistory')
        .mockResolvedValue(mockResponse);
      const result = await controller.getHistory('1', { page: '2', pageSize: '5' }, 1);
      expect(spy).toHaveBeenCalledWith('1', { page: '2', pageSize: '5' });
      expect(result).toEqual(mockResponse);
    });
  });
});
