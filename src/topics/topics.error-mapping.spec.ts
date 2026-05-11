import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TopicsUsecase } from './topics.usecase';
import { NodebbTopicsProvider } from '../nodebb/providers/nodebb-topics.provider';
import { BodyStatus, normalizeOk, normalizeError } from '../nodebb/types';

describe('TopicsModule — provider error mapping regression', () => {
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

  const mockNodebbTopic = {
    tid: 42,
    uid: 1,
    cid: 2,
    title: 'Test Topic',
    slug: 'test-topic',
    mainPid: 100,
    postcount: 5,
    viewcount: 200,
    timestamp: 1700000000,
  };

  describe('BodyStatus.NOT_FOUND mapping', () => {
    it('maps 404 NOT_FOUND to NotFoundException', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(404, 'Topic not found'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });

    it('preserves NotFoundException message for 404', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(404, 'Topic not found'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow('Topic 42 not found');
    });
  });

  describe('BodyStatus.ERROR mapping (server errors)', () => {
    it('maps 500 ERROR to NotFoundException when data is null', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(500, 'Internal Server Error'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 502 ERROR to NotFoundException when data is null', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(502, 'Bad Gateway'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 503 ERROR to NotFoundException when data is null', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(503, 'Service Unavailable'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 504 ERROR to NotFoundException when data is null', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(504, 'Gateway Timeout'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });
  });

  describe('BodyStatus.ERROR mapping (client errors)', () => {
    it('maps 401 ERROR to NotFoundException when data is null', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(401, 'Unauthorized'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 403 ERROR to NotFoundException when data is null', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(403, 'Forbidden'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });

    it('maps 429 ERROR to NotFoundException when data is null', async () => {
      mockTopicsProvider.getById.mockResolvedValue(
        normalizeError(429, 'Too Many Requests'),
      );

      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });
  });

  describe('BodyStatus.OK passthrough', () => {
    it('returns TopicDetail for OK response', async () => {
      mockTopicsProvider.getById.mockResolvedValue(normalizeOk(mockNodebbTopic));

      const result = await usecase.getByTid('42');

      expect(result).toEqual({
        tid: 42,
        uid: 1,
        cid: 2,
        title: 'Test Topic',
        slug: 'test-topic',
        mainPid: 100,
        postcount: 5,
        viewcount: 200,
        timestamp: 1700000000,
        source: 'nodebb',
      });
    });

    it('calls provider with numeric tid', async () => {
      mockTopicsProvider.getById.mockResolvedValue(normalizeOk(mockNodebbTopic));

      await usecase.getByTid('42');

      expect(mockTopicsProvider.getById).toHaveBeenCalledWith(42);
    });
  });

  describe('input validation (pre-provider)', () => {
    it('rejects non-numeric tid before calling provider', async () => {
      await expect(usecase.getByTid('abc')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects zero tid before calling provider', async () => {
      await expect(usecase.getByTid('0')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects negative tid before calling provider', async () => {
      await expect(usecase.getByTid('-5')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects fractional tid before calling provider', async () => {
      await expect(usecase.getByTid('3.14')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });

    it('rejects empty string tid before calling provider', async () => {
      await expect(usecase.getByTid('')).rejects.toThrow(NotFoundException);
      expect(mockTopicsProvider.getById).not.toHaveBeenCalled();
    });
  });
});
