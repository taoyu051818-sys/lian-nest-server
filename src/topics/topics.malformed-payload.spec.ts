import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TopicsUsecase } from './topics.usecase';
import { NodebbTopicsProvider } from '../nodebb/providers/nodebb-topics.provider';
import { BodyStatus } from '../nodebb/types';

describe('TopicsModule — malformed payload coverage', () => {
  let usecase: TopicsUsecase;

  const mockTopicsProvider = {
    getById: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicsUsecase,
        { provide: NodebbTopicsProvider, useValue: mockTopicsProvider },
      ],
    }).compile();

    usecase = module.get<TopicsUsecase>(TopicsUsecase);
    jest.clearAllMocks();
  });

  describe('empty and whitespace tid values', () => {
    it('rejects empty string tid', async () => {
      await expect(usecase.getByTid('')).rejects.toThrow(NotFoundException);
      await expect(usecase.getByTid('')).rejects.toThrow('Invalid tid: ');
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only tid', async () => {
      await expect(usecase.getByTid('   ')).rejects.toThrow(NotFoundException);
      await expect(usecase.getByTid('   ')).rejects.toThrow('Invalid tid:    ');
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects tab-only tid', async () => {
      await expect(usecase.getByTid('\t')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });
  });

  describe('NaN and Infinity tid values', () => {
    it('rejects NaN string tid', async () => {
      await expect(usecase.getByTid('NaN')).rejects.toThrow(NotFoundException);
      await expect(usecase.getByTid('NaN')).rejects.toThrow('Invalid tid: NaN');
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects Infinity string tid', async () => {
      await expect(usecase.getByTid('Infinity')).rejects.toThrow(NotFoundException);
      await expect(usecase.getByTid('Infinity')).rejects.toThrow('Invalid tid: Infinity');
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects negative Infinity string tid', async () => {
      await expect(usecase.getByTid('-Infinity')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });
  });

  describe('string-encoded null/undefined tid values', () => {
    it('rejects "null" string tid', async () => {
      await expect(usecase.getByTid('null')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects "undefined" string tid', async () => {
      await expect(usecase.getByTid('undefined')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });
  });

  describe('special character tid values', () => {
    it('rejects special characters tid', async () => {
      await expect(usecase.getByTid('@#$')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects mixed alphanumeric tid', async () => {
      await expect(usecase.getByTid('12abc')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects emoji tid', async () => {
      await expect(usecase.getByTid('🎉')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects SQL injection attempt tid', async () => {
      await expect(usecase.getByTid("'; DROP TABLE topics; --")).rejects.toThrow(
        NotFoundException,
      );
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });
  });

  describe('boundary numeric tid values', () => {
    it('accepts Number.MAX_SAFE_INTEGER + 1 as valid integer', async () => {
      const overSafe = String(Number.MAX_SAFE_INTEGER + 1);
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: {
          tid: Number.MAX_SAFE_INTEGER + 1, uid: 1, cid: 2, title: 'T', slug: 't',
          mainPid: 1, postcount: 1, viewcount: 1, timestamp: 1,
        },
        error: null,
      });
      const result = await usecase.getByTid(overSafe);
      expect(result.tid).toBe(Number.MAX_SAFE_INTEGER + 1);
    });

    it('accepts leading-zero tid as valid numeric', async () => {
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: {
          tid: 7, uid: 1, cid: 2, title: 'T', slug: 't',
          mainPid: 1, postcount: 1, viewcount: 1, timestamp: 1,
        },
        error: null,
      });
      const result = await usecase.getByTid('007');
      expect(result.tid).toBe(7);
      expect(mockTopicsProvider.getById).toHaveBeenCalledWith(7);
    });

    it('rejects negative zero tid', async () => {
      await expect(usecase.getByTid('-0')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('accepts scientific notation tid as valid numeric', async () => {
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: {
          tid: 100, uid: 1, cid: 2, title: 'T', slug: 't',
          mainPid: 1, postcount: 1, viewcount: 1, timestamp: 1,
        },
        error: null,
      });
      const result = await usecase.getByTid('1e2');
      expect(result.tid).toBe(100);
      expect(mockTopicsProvider.getById).toHaveBeenCalledWith(100);
    });
  });

  describe('error message verification', () => {
    const cases = [
      { input: '', expected: 'Invalid tid: ' },
      { input: 'abc', expected: 'Invalid tid: abc' },
      { input: 'NaN', expected: 'Invalid tid: NaN' },
      { input: 'Infinity', expected: 'Invalid tid: Infinity' },
      { input: '1.5', expected: 'Invalid tid: 1.5' },
      { input: '0', expected: 'Invalid tid: 0' },
      { input: '-1', expected: 'Invalid tid: -1' },
    ];

    it.each(cases)(
      'includes raw tid "$input" in error message',
      async ({ input, expected }) => {
        await expect(usecase.getByTid(input)).rejects.toThrow(expected);
      },
    );
  });
});
