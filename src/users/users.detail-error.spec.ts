import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersUsecase } from './users.usecase';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';
import { BodyStatus, normalizeOk, normalizeError } from '../nodebb/types';

describe('UsersModule — detail provider error mapping regression', () => {
  let usecase: UsersUsecase;

  const mockUsersProvider = {
    getByUid: jest.fn(),
    getPosts: jest.fn(),
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

  const mockNodebbUser = {
    uid: 42,
    username: 'testuser',
    userslug: 'testuser',
    joindate: 1700000000000,
    reputation: 10,
    postcount: 25,
  };

  describe('BodyStatus.NOT_FOUND mapping', () => {
    it('maps 404 NOT_FOUND to NotFoundException', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(404, 'User not found'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });

    it('preserves NotFoundException message for 404', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(404, 'User not found'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow('User 42 not found');
    });
  });

  describe('BodyStatus.ERROR mapping (server errors)', () => {
    it('maps 500 ERROR to NotFoundException when data is null', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(500, 'Internal Server Error'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 502 ERROR to NotFoundException when data is null', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(502, 'Bad Gateway'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 503 ERROR to NotFoundException when data is null', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(503, 'Service Unavailable'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 504 ERROR to NotFoundException when data is null', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(504, 'Gateway Timeout'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });
  });

  describe('BodyStatus.ERROR mapping (client errors)', () => {
    it('maps 401 ERROR to NotFoundException when data is null', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(401, 'Unauthorized'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 403 ERROR to NotFoundException when data is null', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(403, 'Forbidden'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 429 ERROR to NotFoundException when data is null', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(
        normalizeError(429, 'Too Many Requests'),
      );

      await expect(usecase.getByUid('42')).rejects.toThrow(NotFoundException);
    });
  });

  describe('BodyStatus.OK passthrough', () => {
    it('returns UserDetail for OK response', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(normalizeOk(mockNodebbUser));

      const result = await usecase.getByUid('42');

      expect(result).toEqual({
        uid: '42',
        username: 'testuser',
        userslug: 'testuser',
        joinedAt: new Date(1700000000000).toISOString(),
        reputation: 10,
        postCount: 25,
      });
    });

    it('calls provider with numeric uid', async () => {
      mockUsersProvider.getByUid.mockResolvedValue(normalizeOk(mockNodebbUser));

      await usecase.getByUid('42');

      expect(mockUsersProvider.getByUid).toHaveBeenCalledWith(42);
    });
  });

  describe('input validation (pre-provider)', () => {
    it('rejects non-numeric uid before calling provider', async () => {
      await expect(usecase.getByUid('abc')).rejects.toThrow(NotFoundException);
      expect(mockUsersProvider.getByUid).not.toHaveBeenCalled();
    });

    it('rejects zero uid before calling provider', async () => {
      await expect(usecase.getByUid('0')).rejects.toThrow(NotFoundException);
      expect(mockUsersProvider.getByUid).not.toHaveBeenCalled();
    });

    it('rejects negative uid before calling provider', async () => {
      await expect(usecase.getByUid('-5')).rejects.toThrow(NotFoundException);
      expect(mockUsersProvider.getByUid).not.toHaveBeenCalled();
    });

    it('rejects fractional uid before calling provider', async () => {
      await expect(usecase.getByUid('3.14')).rejects.toThrow(NotFoundException);
      expect(mockUsersProvider.getByUid).not.toHaveBeenCalled();
    });

    it('rejects empty string uid before calling provider', async () => {
      await expect(usecase.getByUid('')).rejects.toThrow(NotFoundException);
      expect(mockUsersProvider.getByUid).not.toHaveBeenCalled();
    });
  });
});
