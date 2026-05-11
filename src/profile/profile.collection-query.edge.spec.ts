import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProfileUsecase } from './profile.usecase';
import { NodebbUsersProvider } from '../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../nodebb/types';

describe('ProfileUsecase collection query edge cases', () => {
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
      providers: [
        ProfileUsecase,
        { provide: NodebbUsersProvider, useValue: mockUsersProvider },
      ],
    }).compile();

    usecase = module.get<ProfileUsecase>(ProfileUsecase);
    jest.clearAllMocks();
  });

  const endpoints = [
    {
      name: 'getSaved',
      providerMethod: 'getSaved' as const,
      timestampField: 'savedAt',
    },
    {
      name: 'getLiked',
      providerMethod: 'getLiked' as const,
      timestampField: 'likedAt',
    },
    {
      name: 'getHistory',
      providerMethod: 'getHistory' as const,
      timestampField: 'viewedAt',
    },
  ];

  const okEmpty = {
    status: BodyStatus.OK,
    statusCode: 200,
    data: [],
    error: null,
  };

  describe.each(endpoints)('$name', ({ name, providerMethod }) => {
    const call = (uid: string, query?: Record<string, unknown>) =>
      (usecase as any)[name](uid, query);

    describe('page coercion boundaries', () => {
      it('should accept page=1 (minimum valid)', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', { page: 1, pageSize: 10 });
        expect(result.page).toBe(1);
      });

      it('should reject page=0 with BadRequestException', async () => {
        await expect(call('1', { page: 0 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject page=-1 with BadRequestException', async () => {
        await expect(call('1', { page: -1 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject fractional page=1.5 with BadRequestException', async () => {
        await expect(call('1', { page: 1.5 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject non-numeric string page with BadRequestException', async () => {
        await expect(call('1', { page: 'abc' })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject fractional string page=2.5 with BadRequestException', async () => {
        await expect(call('1', { page: '2.5' })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should coerce valid string page="3" to number 3', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', { page: '3' });
        expect(result.page).toBe(3);
      });
    });

    describe('pageSize coercion boundaries', () => {
      it('should accept pageSize=1 (minimum valid)', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', { pageSize: 1 });
        expect(result.pageSize).toBe(1);
      });

      it('should accept pageSize=50 (maximum valid)', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', { pageSize: 50 });
        expect(result.pageSize).toBe(50);
      });

      it('should reject pageSize=0 with BadRequestException', async () => {
        await expect(call('1', { pageSize: 0 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject pageSize=51 (exceeds max) with BadRequestException', async () => {
        await expect(call('1', { pageSize: 51 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject negative pageSize with BadRequestException', async () => {
        await expect(call('1', { pageSize: -5 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject fractional pageSize=5.5 with BadRequestException', async () => {
        await expect(call('1', { pageSize: 5.5 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject non-numeric string pageSize with BadRequestException', async () => {
        await expect(call('1', { pageSize: 'xyz' })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should reject string pageSize="51" exceeding max with BadRequestException', async () => {
        await expect(call('1', { pageSize: '51' })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should coerce valid string pageSize="5" to number 5', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', { pageSize: '5' });
        expect(result.pageSize).toBe(5);
      });
    });

    describe('default pagination', () => {
      it('should default to page=1 pageSize=10 when query is undefined', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1');
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(10);
      });

      it('should default to page=1 pageSize=10 when query is empty', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', {});
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(10);
      });
    });

    describe('provider fallback', () => {
      it('should return fallback with preserved pagination on provider error', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue({
          status: BodyStatus.ERROR,
          statusCode: 500,
          data: null,
          error: 'Internal error',
        });

        const result = await call('1', { page: 3, pageSize: 15 });

        expect(result.source).toBe('fallback');
        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
        expect(result.page).toBe(3);
        expect(result.pageSize).toBe(15);
      });

      it('should return fallback with preserved pagination on provider exception', async () => {
        mockUsersProvider[providerMethod].mockRejectedValue(
          new Error('network error'),
        );

        const result = await call('1', { page: 2, pageSize: 20 });

        expect(result.source).toBe('fallback');
        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
        expect(result.page).toBe(2);
        expect(result.pageSize).toBe(20);
      });

      it('should return fallback with default pagination on provider error when no query', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue({
          status: BodyStatus.NOT_FOUND,
          statusCode: 404,
          data: null,
          error: 'Not found',
        });

        const result = await call('1');

        expect(result.source).toBe('fallback');
        expect(result.items).toEqual([]);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(10);
      });
    });

    describe('mixed string coercion', () => {
      it('should coerce both string page and pageSize from @Query()', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', { page: '2', pageSize: '5' });
        expect(result.page).toBe(2);
        expect(result.pageSize).toBe(5);
      });

      it('should use default pageSize when only string page provided', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', { page: '4' });
        expect(result.page).toBe(4);
        expect(result.pageSize).toBe(10);
      });

      it('should use default page when only string pageSize provided', async () => {
        mockUsersProvider[providerMethod].mockResolvedValue(okEmpty);
        const result = await call('1', { pageSize: '25' });
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(25);
      });
    });
  });
});
