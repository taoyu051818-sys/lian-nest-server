import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersUsecase } from './users.usecase';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';

describe('UsersController', () => {
  let controller: UsersController;
  let usecase: UsersUsecase;

  const mockUsersProvider = {
    getByUid: jest.fn(),
    getBySlug: jest.fn(),
    getSaved: jest.fn(),
    getLiked: jest.fn(),
    getPosts: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersUsecase,
        { provide: NodebbUsersProvider, useValue: mockUsersProvider },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usecase = module.get<UsersUsecase>(UsersUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getByUid', () => {
    it('should delegate to usecase', async () => {
      const spy = jest.spyOn(usecase, 'getByUid').mockResolvedValue({
        uid: '1',
        username: 'testuser',
        userslug: 'testuser',
        joinedAt: '2026-01-01T00:00:00.000Z',
        reputation: 0,
        postCount: 0,
      });
      const result = await controller.getByUid('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result.uid).toBe('1');
    });
  });

  describe('getPosts', () => {
    it('should delegate to usecase', async () => {
      const spy = jest.spyOn(usecase, 'getPosts').mockResolvedValue({
        posts: [
          {
            pid: 101,
            tid: 10,
            uid: 1,
            content: 'hello',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
        source: 'nodebb',
      });
      const result = await controller.getPosts('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result.posts).toHaveLength(1);
      expect(result.source).toBe('nodebb');
    });
  });

  describe('uid parsing regression', () => {
    it('should propagate NotFoundException for non-numeric uid on detail', async () => {
      jest.spyOn(usecase, 'getByUid').mockRejectedValue(new NotFoundException('Invalid uid: abc'));
      await expect(controller.getByUid('abc')).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException for zero uid on detail', async () => {
      jest.spyOn(usecase, 'getByUid').mockRejectedValue(new NotFoundException('Invalid uid: 0'));
      await expect(controller.getByUid('0')).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException for negative uid on detail', async () => {
      jest.spyOn(usecase, 'getByUid').mockRejectedValue(new NotFoundException('Invalid uid: -1'));
      await expect(controller.getByUid('-1')).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException for non-numeric uid on posts', async () => {
      jest.spyOn(usecase, 'getPosts').mockRejectedValue(new NotFoundException('Invalid uid: abc'));
      await expect(controller.getPosts('abc')).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException for zero uid on posts', async () => {
      jest.spyOn(usecase, 'getPosts').mockRejectedValue(new NotFoundException('Invalid uid: 0'));
      await expect(controller.getPosts('0')).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException for negative uid on posts', async () => {
      jest.spyOn(usecase, 'getPosts').mockRejectedValue(new NotFoundException('Invalid uid: -1'));
      await expect(controller.getPosts('-1')).rejects.toThrow(NotFoundException);
    });
  });
});
