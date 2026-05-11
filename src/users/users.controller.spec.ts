import { Test, TestingModule } from '@nestjs/testing';
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
});
