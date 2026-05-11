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
    it('should delegate to usecase', async () => {
      const spy = jest
        .spyOn(usecase, 'getSaved')
        .mockRejectedValue(new Error('not implemented'));
      await expect(controller.getSaved('1')).rejects.toThrow(
        'not implemented',
      );
      expect(spy).toHaveBeenCalledWith('1');
    });
  });

  describe('getLiked', () => {
    it('should delegate to usecase', async () => {
      const spy = jest
        .spyOn(usecase, 'getLiked')
        .mockRejectedValue(new Error('not implemented'));
      await expect(controller.getLiked('1')).rejects.toThrow(
        'not implemented',
      );
      expect(spy).toHaveBeenCalledWith('1');
    });
  });

  describe('getHistory', () => {
    it('should delegate to usecase', async () => {
      const spy = jest
        .spyOn(usecase, 'getHistory')
        .mockRejectedValue(new Error('not implemented'));
      await expect(controller.getHistory('1')).rejects.toThrow(
        'not implemented',
      );
      expect(spy).toHaveBeenCalledWith('1');
    });
  });
});
