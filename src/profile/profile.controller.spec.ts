import { Test, TestingModule } from '@nestjs/testing';
import { ProfileController } from './profile.controller';
import { ProfileUsecase } from './profile.usecase';

describe('ProfileController', () => {
  let controller: ProfileController;
  let usecase: ProfileUsecase;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [ProfileUsecase],
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
        displayName: 'Test User',
        avatar: null,
        bio: null,
        postCount: 0,
        reputation: 0,
        joinedAt: '2026-01-01T00:00:00Z',
      });
      const result = await controller.getPublicProfile('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result.uid).toBe('1');
    });
  });

  describe('getSaved', () => {
    it('should delegate to usecase', async () => {
      const spy = jest.spyOn(usecase, 'getSaved').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      const result = await controller.getSaved('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result.items).toEqual([]);
    });
  });

  describe('getLiked', () => {
    it('should delegate to usecase', async () => {
      const spy = jest.spyOn(usecase, 'getLiked').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      const result = await controller.getLiked('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result.items).toEqual([]);
    });
  });

  describe('getHistory', () => {
    it('should delegate to usecase', async () => {
      const spy = jest.spyOn(usecase, 'getHistory').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      const result = await controller.getHistory('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result.items).toEqual([]);
    });
  });
});
