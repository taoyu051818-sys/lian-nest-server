import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProfileUsecase } from './profile.usecase';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../nodebb/types';

describe('ProfileUsecase', () => {
  let usecase: ProfileUsecase;

  const mockUsersProvider = {
    getByUid: jest.fn(),
    getBySlug: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileUsecase,
        { provide: NodebbUsersProvider, useValue: mockUsersProvider },
      ],
    }).compile();

    usecase = module.get<ProfileUsecase>(ProfileUsecase);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(usecase).toBeDefined();
  });

  describe('getPublicProfile', () => {
    const mockNodebbUser = {
      uid: 42,
      username: 'testuser',
      userslug: 'testuser',
      joindate: 1735689600000, // 2025-01-01T00:00:00.000Z
      reputation: 100,
      postcount: 25,
    };

    it('should map NodebbUser to PublicProfile', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockNodebbUser,
        error: null,
      });

      const result = await usecase.getPublicProfile('42');

      expect(result).toEqual({
        uid: '42',
        username: 'testuser',
        displayName: 'testuser',
        avatar: null,
        bio: null,
        postCount: 25,
        reputation: 100,
        joinedAt: '2025-01-01T00:00:00.000Z',
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

      await usecase.getPublicProfile('42');
      expect(mockUsersProvider.getByUid).toHaveBeenCalledWith(42);
    });

    it('should throw NotFoundException for non-numeric uid', async () => {
      await expect(usecase.getPublicProfile('abc')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for zero uid', async () => {
      await expect(usecase.getPublicProfile('0')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for negative uid', async () => {
      await expect(usecase.getPublicProfile('-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for fractional uid', async () => {
      await expect(usecase.getPublicProfile('1.5')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'User not found',
      });

      await expect(usecase.getPublicProfile('999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when data is null with error status', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'Internal error',
      });

      await expect(usecase.getPublicProfile('42')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should convert joindate timestamp to ISO string', async () => {
      mockUsersProvider.getByUid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { ...mockNodebbUser, joindate: 0 },
        error: null,
      });

      const result = await usecase.getPublicProfile('42');
      expect(result.joinedAt).toBe('1970-01-01T00:00:00.000Z');
    });
  });

  describe('getSaved', () => {
    it('should throw not-implemented error with uid', async () => {
      await expect(usecase.getSaved('42')).rejects.toThrow(
        'getSaved(42) not implemented',
      );
    });
  });

  describe('getLiked', () => {
    it('should throw not-implemented error with uid', async () => {
      await expect(usecase.getLiked('42')).rejects.toThrow(
        'getLiked(42) not implemented',
      );
    });
  });

  describe('getHistory', () => {
    it('should throw not-implemented error with uid', async () => {
      await expect(usecase.getHistory('42')).rejects.toThrow(
        'getHistory(42) not implemented',
      );
    });
  });
});
