import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersUsecase } from './users.usecase';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../nodebb/types';

describe('UsersUsecase', () => {
  let usecase: UsersUsecase;

  const mockUsersProvider = {
    getByUid: jest.fn(),
    getBySlug: jest.fn(),
    getSaved: jest.fn(),
    getLiked: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersUsecase,
        { provide: NodebbUsersProvider, useValue: mockUsersProvider },
      ],
    }).compile();

    usecase = module.get<UsersUsecase>(UsersUsecase);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(usecase).toBeDefined();
  });

  describe('getByUid', () => {
    const mockNodebbUser = {
      uid: 42,
      username: 'testuser',
      userslug: 'testuser',
      joindate: 1735689600000, // 2025-01-01T00:00:00.000Z
      reputation: 100,
      postcount: 25,
    };

    it('should map NodebbUser to UserDetail', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockNodebbUser,
        error: null,
      });

      const result = await usecase.getByUid('42');

      expect(result).toEqual({
        uid: '42',
        username: 'testuser',
        userslug: 'testuser',
        joinedAt: '2025-01-01T00:00:00.000Z',
        reputation: 100,
        postCount: 25,
      });
      expect(mockUsersProvider.getByUid).toHaveBeenCalledWith(42);
    });

    it('should convert uid string to number for provider call', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockNodebbUser,
        error: null,
      });

      await usecase.getByUid('42');
      expect(mockUsersProvider.getByUid).toHaveBeenCalledWith(42);
    });

    it('should throw NotFoundException for non-numeric uid', async () => {
      await expect(usecase.getByUid('abc')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for zero uid', async () => {
      await expect(usecase.getByUid('0')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for negative uid', async () => {
      await expect(usecase.getByUid('-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for fractional uid', async () => {
      await expect(usecase.getByUid('1.5')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'User not found',
      });

      await expect(usecase.getByUid('999')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when data is null with error status', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'Internal error',
      });

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });

    it('should convert joindate timestamp to ISO string', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { ...mockNodebbUser, joindate: 0 },
        error: null,
      });

      const result = await usecase.getByUid('42');
      expect(result.joinedAt).toBe('1970-01-01T00:00:00.000Z');
    });
  });
});
