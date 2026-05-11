import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

    it('should throw NotFoundException for empty string uid', async () => {
      await expect(usecase.getByUid('')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for whitespace-only uid', async () => {
      await expect(usecase.getByUid('   ')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for NaN string uid', async () => {
      await expect(usecase.getByUid('NaN')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for Infinity uid', async () => {
      await expect(usecase.getByUid('Infinity')).rejects.toThrow(NotFoundException);
    });

    it('should include raw uid in error message for invalid uid', async () => {
      await expect(usecase.getByUid('abc')).rejects.toThrow('Invalid uid: abc');
    });

    it('should include raw uid in error message for zero uid', async () => {
      await expect(usecase.getByUid('0')).rejects.toThrow('Invalid uid: 0');
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

  describe('getPosts', () => {
    const mockPosts = [
      {
        pid: 101,
        tid: 10,
        uid: 42,
        content: 'First post content',
        timestamp: 1735689600000,
      },
      {
        pid: 202,
        tid: 20,
        uid: 42,
        content: 'Second post content',
        timestamp: 1735776000000,
      },
    ];

    it('should map NodebbPost[] to UserPostItem[]', async () => {
      mockUsersProvider.getPosts.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockPosts,
        error: null,
      });

      const result = await usecase.getPosts('42');

      expect(result.posts).toHaveLength(2);
      expect(result.posts[0]).toEqual({
        pid: 101,
        tid: 10,
        uid: 42,
        content: 'First post content',
        timestamp: '2025-01-01T00:00:00.000Z',
      });
      expect(result.source).toBe('nodebb');
      expect(result.totalPosts).toBe(2);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
      expect(mockUsersProvider.getPosts).toHaveBeenCalledWith(42);
    });

    it('should return fallback when provider returns non-OK status', async () => {
      mockUsersProvider.getPosts.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'Internal error',
      });

      const result = await usecase.getPosts('42');

      expect(result.posts).toEqual([]);
      expect(result.source).toBe('fallback');
      expect(result.totalPosts).toBe(0);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should return fallback when provider throws', async () => {
      mockUsersProvider.getPosts.mockRejectedValue(new Error('network'));

      const result = await usecase.getPosts('42');

      expect(result.posts).toEqual([]);
      expect(result.source).toBe('fallback');
      expect(result.totalPosts).toBe(0);
    });

    it('should throw NotFoundException for non-numeric uid', async () => {
      await expect(usecase.getPosts('abc')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for zero uid', async () => {
      await expect(usecase.getPosts('0')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for negative uid', async () => {
      await expect(usecase.getPosts('-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for fractional uid', async () => {
      await expect(usecase.getPosts('1.5')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for empty string uid', async () => {
      await expect(usecase.getPosts('')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for whitespace-only uid', async () => {
      await expect(usecase.getPosts('   ')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for NaN string uid', async () => {
      await expect(usecase.getPosts('NaN')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for Infinity uid', async () => {
      await expect(usecase.getPosts('Infinity')).rejects.toThrow(NotFoundException);
    });

    it('should include raw uid in error message for invalid uid', async () => {
      await expect(usecase.getPosts('abc')).rejects.toThrow('Invalid uid: abc');
    });

    it('should return empty posts when data is empty array', async () => {
      mockUsersProvider.getPosts.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await usecase.getPosts('42');

      expect(result.posts).toEqual([]);
      expect(result.source).toBe('nodebb');
      expect(result.totalPosts).toBe(0);
    });

    describe('pagination coercion', () => {
      const manyPosts = Array.from({ length: 55 }, (_, i) => ({
        pid: i + 1,
        tid: 10,
        uid: 42,
        content: `Post ${i + 1}`,
        timestamp: 1735689600000,
      }));

      beforeEach(() => {
        mockUsersProvider.getPosts.mockResolvedValue({
          status: BodyStatus.OK,
          statusCode: 200,
          data: manyPosts,
          error: null,
        });
      });

      it('should default to page 1 and perPage 20', async () => {
        const result = await usecase.getPosts('42');
        expect(result.page).toBe(1);
        expect(result.perPage).toBe(20);
        expect(result.posts).toHaveLength(20);
        expect(result.totalPosts).toBe(55);
      });

      it('should slice to requested page', async () => {
        const result = await usecase.getPosts('42', { page: '2', perPage: '10' });
        expect(result.page).toBe(2);
        expect(result.perPage).toBe(10);
        expect(result.posts).toHaveLength(10);
        expect(result.posts[0].pid).toBe(11);
        expect(result.totalPosts).toBe(55);
      });

      it('should return partial page for last page', async () => {
        const result = await usecase.getPosts('42', { page: '3', perPage: '20' });
        expect(result.page).toBe(3);
        expect(result.posts).toHaveLength(15);
        expect(result.posts[0].pid).toBe(41);
      });

      it('should return empty posts for page beyond total', async () => {
        const result = await usecase.getPosts('42', { page: '10', perPage: '20' });
        expect(result.posts).toHaveLength(0);
        expect(result.totalPosts).toBe(55);
      });

      it('should throw BadRequestException for invalid page', async () => {
        await expect(usecase.getPosts('42', { page: 'abc' })).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for zero page', async () => {
        await expect(usecase.getPosts('42', { page: '0' })).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for negative page', async () => {
        await expect(usecase.getPosts('42', { page: '-1' })).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for fractional page', async () => {
        await expect(usecase.getPosts('42', { page: '1.5' })).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for NaN page', async () => {
        await expect(usecase.getPosts('42', { page: 'NaN' })).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for invalid perPage', async () => {
        await expect(usecase.getPosts('42', { perPage: 'abc' })).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for zero perPage', async () => {
        await expect(usecase.getPosts('42', { perPage: '0' })).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for negative perPage', async () => {
        await expect(usecase.getPosts('42', { perPage: '-5' })).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for perPage exceeding 100', async () => {
        await expect(usecase.getPosts('42', { perPage: '101' })).rejects.toThrow(BadRequestException);
      });

      it('should accept perPage of exactly 100', async () => {
        const result = await usecase.getPosts('42', { perPage: '100' });
        expect(result.perPage).toBe(100);
      });

      it('should default perPage when only page is provided', async () => {
        const result = await usecase.getPosts('42', { page: '1' });
        expect(result.page).toBe(1);
        expect(result.perPage).toBe(20);
      });

      it('should default page when only perPage is provided', async () => {
        const result = await usecase.getPosts('42', { perPage: '5' });
        expect(result.page).toBe(1);
        expect(result.perPage).toBe(5);
        expect(result.posts).toHaveLength(5);
      });

      it('should include raw value in error message for invalid page', async () => {
        await expect(usecase.getPosts('42', { page: 'xyz' })).rejects.toThrow('Invalid page: xyz');
      });

      it('should include raw value in error message for invalid perPage', async () => {
        await expect(usecase.getPosts('42', { perPage: '-1' })).rejects.toThrow('Invalid perPage: -1');
      });

      it('should still return pagination metadata on fallback', async () => {
        mockUsersProvider.getPosts.mockResolvedValue({
          status: BodyStatus.ERROR,
          statusCode: 500,
          data: null,
          error: 'fail',
        });
        const result = await usecase.getPosts('42', { page: '2', perPage: '10' });
        expect(result.posts).toEqual([]);
        expect(result.source).toBe('fallback');
        expect(result.totalPosts).toBe(0);
        expect(result.page).toBe(2);
        expect(result.perPage).toBe(10);
      });
    });
  });
});
