import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './controllers/messages.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { MessagesUseCase } from './use-cases/messages.use-case';
import { NotificationsUseCase } from './use-cases/notifications.use-case';
import { NodebbNotificationsProvider } from '../nodebb';
import { BodyStatus } from '../nodebb';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('MessagesModule', () => {
  let module: TestingModule;
  let messagesController: MessagesController;
  let notificationsController: NotificationsController;
  let messagesUseCase: MessagesUseCase;
  let notificationsUseCase: NotificationsUseCase;
  let provider: NodebbNotificationsProvider;

  const providerMock = {
    list: jest.fn(),
    markRead: jest.fn(),
  };

  beforeEach(async () => {
    providerMock.list.mockReset();
    providerMock.markRead.mockReset();

    module = await Test.createTestingModule({
      controllers: [MessagesController, NotificationsController],
      providers: [
        MessagesUseCase,
        NotificationsUseCase,
        { provide: NodebbNotificationsProvider, useValue: providerMock },
      ],
    }).compile();

    messagesController = module.get<MessagesController>(MessagesController);
    notificationsController = module.get<NotificationsController>(
      NotificationsController,
    );
    messagesUseCase = module.get<MessagesUseCase>(MessagesUseCase);
    notificationsUseCase = module.get<NotificationsUseCase>(
      NotificationsUseCase,
    );
    provider = module.get<NodebbNotificationsProvider>(
      NodebbNotificationsProvider,
    );
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
    expect(messagesController).toBeDefined();
    expect(notificationsController).toBeDefined();
    expect(messagesUseCase).toBeDefined();
    expect(notificationsUseCase).toBeDefined();
  });

  describe('MessagesController', () => {
    it('should throw not implemented for sendMessage', async () => {
      await expect(
        messagesController.sendMessage({ toUid: 1, content: 'test' }),
      ).rejects.toThrow('Not implemented: MessagesUseCase.sendMessage');
    });

    it('should return empty paginated list for listMessages with defaults', async () => {
      const result = await messagesController.listMessages();
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 1,
        perPage: 20,
      });
    });

    it('should parse and forward pagination params', async () => {
      const result = await messagesController.listMessages('2', '10');
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 2,
        perPage: 10,
      });
    });

    it('should throw not implemented for markRead', async () => {
      await expect(messagesController.markRead('1')).rejects.toThrow(
        'Not implemented: MessagesUseCase.markRead',
      );
    });
  });

  describe('NotificationsController', () => {
    it('should delegate listNotifications to use case', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await notificationsController.listNotifications();
      expect(result).toEqual({ notifications: [], totalCount: 0 });
    });

    it('should return unread count from use case', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { nid: '1', type: 'test', bodyShort: 'a', nidFrom: 1, datetime: 0, read: false },
          { nid: '2', type: 'test', bodyShort: 'b', nidFrom: 2, datetime: 0, read: true },
        ],
        error: null,
      });
      const mockRes = { set: jest.fn() };
      const result = await notificationsController.getUnreadCount(mockRes as any);
      expect(result).toEqual({ count: 1 });
      expect(mockRes.set).not.toHaveBeenCalled();
    });

    it('should set X-Fallback header when provider fails', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'NodeBB unreachable',
      });
      const mockRes = { set: jest.fn() };
      const result = await notificationsController.getUnreadCount(mockRes as any);
      expect(result).toEqual({ count: 0 });
      expect(mockRes.set).toHaveBeenCalledWith('X-Fallback', 'true');
    });

    it('should delegate markRead to use case on success', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });
      await expect(
        notificationsController.markRead('test-nid'),
      ).resolves.toBeUndefined();
      expect(providerMock.markRead).toHaveBeenCalledWith('test-nid', {
        mode: 'none',
      });
    });
  });

  describe('MessagesUseCase', () => {
    it('should throw not implemented for sendMessage', async () => {
      await expect(
        messagesUseCase.sendMessage(1, { toUid: 2, content: 'test' }),
      ).rejects.toThrow('Not implemented');
    });

    it('should return empty list with default pagination', async () => {
      const result = await messagesUseCase.listMessages(1);
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 1,
        perPage: 20,
      });
    });

    it('should forward custom pagination values', async () => {
      const result = await messagesUseCase.listMessages(1, 3, 15);
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 3,
        perPage: 15,
      });
    });

    it('should return response matching parity schema shape', async () => {
      const result = await messagesUseCase.listMessages(1);
      // Parity contract: required keys present, correct types
      expect(Array.isArray(result.messages)).toBe(true);
      expect(typeof result.totalCount).toBe('number');
      expect(typeof result.page).toBe('number');
      expect(typeof result.perPage).toBe('number');
      expect(result.totalCount).toBeGreaterThanOrEqual(0);
      expect(result.page).toBeGreaterThanOrEqual(1);
      expect(result.perPage).toBeGreaterThanOrEqual(1);
      expect(result.perPage).toBeLessThanOrEqual(50);
    });

    it('should throw not implemented for markRead', async () => {
      await expect(messagesUseCase.markRead(1, 1)).rejects.toThrow(
        'Not implemented',
      );
    });
  });

  describe('NotificationsUseCase', () => {
    it('should return mapped notifications from provider', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          {
            nid: 'notif-1',
            type: 'mention',
            bodyShort: 'User mentioned you',
            bodyLong: 'Full text',
            nidFrom: 42,
            datetime: 1700000000000,
            read: false,
          },
        ],
        error: null,
      });

      const result = await notificationsUseCase.listNotifications(1);
      expect(result.notifications).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.notifications[0]).toEqual({
        nid: 'notif-1',
        type: 'mention',
        bodyShort: 'User mentioned you',
        bodyLong: 'Full text',
        fromUid: 42,
        datetime: 1700000000000,
        read: false,
      });
      expect(provider.list).toHaveBeenCalledWith({ mode: 'none' });
    });

    it('should return empty list when provider returns error', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'NodeBB unreachable',
      });

      const result = await notificationsUseCase.listNotifications(1);
      expect(result).toEqual({ notifications: [], totalCount: 0 });
    });

    it('should return empty list when provider returns empty data', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await notificationsUseCase.listNotifications(1);
      expect(result).toEqual({ notifications: [], totalCount: 0 });
    });

    it('should return 0 for getUnreadCount with empty list', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });
      const result = await notificationsUseCase.getUnreadCount(1);
      expect(result).toEqual({ count: 0, fallback: false });
    });

    it('should count unread notifications from list', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { nid: '1', type: 'test', bodyShort: 'a', nidFrom: 1, datetime: 0, read: false },
          { nid: '2', type: 'test', bodyShort: 'b', nidFrom: 2, datetime: 0, read: true },
          { nid: '3', type: 'test', bodyShort: 'c', nidFrom: 3, datetime: 0, read: false },
          { nid: '4', type: 'test', bodyShort: 'd', nidFrom: 4, datetime: 0, read: true },
        ],
        error: null,
      });
      const result = await notificationsUseCase.getUnreadCount(1);
      expect(result).toEqual({ count: 2, fallback: false });
    });

    it('should return fallback true when provider returns error', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'NodeBB unreachable',
      });
      const result = await notificationsUseCase.getUnreadCount(1);
      expect(result).toEqual({ count: 0, fallback: true });
    });

    it('should return fallback true when provider returns null data', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });
      const result = await notificationsUseCase.getUnreadCount(1);
      expect(result).toEqual({ count: 0, fallback: true });
    });

    it('should call provider.markRead on success', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });
      await expect(
        notificationsUseCase.markRead(1, 'notif-1'),
      ).resolves.toBeUndefined();
      expect(providerMock.markRead).toHaveBeenCalledWith('notif-1', {
        mode: 'none',
      });
    });

    it('should throw BadRequestException for empty nid', async () => {
      await expect(
        notificationsUseCase.markRead(1, ''),
      ).rejects.toThrow(BadRequestException);
      await expect(
        notificationsUseCase.markRead(1, '   '),
      ).rejects.toThrow(BadRequestException);
      expect(providerMock.markRead).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when provider returns NOT_FOUND', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'Notification not found',
      });
      await expect(
        notificationsUseCase.markRead(1, 'missing-nid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw Error when provider returns ERROR', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'NodeBB unreachable',
      });
      await expect(
        notificationsUseCase.markRead(1, 'test-nid'),
      ).rejects.toThrow('NodeBB unreachable');
    });
  });
});
