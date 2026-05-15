import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './controllers/messages.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { MessagesUseCase } from './usecases/messages.usecase';
import { NotificationsUseCase } from './usecases/notifications.usecase';
import { NodebbNotificationsProvider, NodebbChatsProvider } from '../nodebb';
import { BodyStatus } from '../nodebb';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth';

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

  const chatsProviderMock = {
    listRooms: jest.fn(),
    getMessages: jest.fn(),
    send: jest.fn(),
    createRoom: jest.fn(),
    markRead: jest.fn(),
  };

  beforeEach(async () => {
    providerMock.list.mockReset();
    providerMock.markRead.mockReset();
    chatsProviderMock.listRooms.mockReset();
    chatsProviderMock.send.mockReset();
    chatsProviderMock.createRoom.mockReset();
    chatsProviderMock.markRead.mockReset();

    module = await Test.createTestingModule({
      controllers: [MessagesController, NotificationsController],
      providers: [
        MessagesUseCase,
        NotificationsUseCase,
        { provide: NodebbNotificationsProvider, useValue: providerMock },
        { provide: NodebbChatsProvider, useValue: chatsProviderMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

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
    it('should send message via provider and return MessageResponseDto', async () => {
      chatsProviderMock.createRoom.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { roomId: 100, uids: [1, 2], owner: 1 },
        error: null,
      });

      const result = await messagesController.sendMessage({ toUid: 2, content: 'test' }, 1);

      expect(result.fromUid).toBe(1);
      expect(result.toUid).toBe(2);
      expect(result.content).toBe('test');
      expect(result.messageId).toBe('100');
      expect(result.read).toBe(false);
    });

    it('should create room when no roomId provided', async () => {
      chatsProviderMock.createRoom.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { roomId: 10, uids: [1, 2], owner: 1 },
        error: null,
      });

      const result = await messagesController.sendMessage({ toUid: 2, content: 'hello' }, 1);

      expect(result.fromUid).toBe(1);
      expect(result.toUid).toBe(2);
      expect(result.content).toBe('hello');
      expect(chatsProviderMock.createRoom).toHaveBeenCalled();
    });

    it('should return mapped messages from chat rooms', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { roomId: 1, uids: [1, 2], owner: 1, lastMessage: { content: 'hi', timestamp: 1700000000, fromUid: 2 }, unread: 1 },
        ],
        error: null,
      });

      const result = await messagesController.listMessages(1);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('hi');
      expect(result.messages[0].read).toBe(false);
      expect(result.totalCount).toBe(1);
    });

    it('should return empty list when provider returns empty rooms', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesController.listMessages(1);
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 1,
        perPage: 20,
      });
    });

    it('should return empty list when provider returns error', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'NodeBB unreachable',
      });

      const result = await messagesController.listMessages(1);
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 1,
        perPage: 20,
      });
    });

    it('should parse and forward pagination params', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesController.listMessages(1, '2', '10');
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 2,
        perPage: 10,
      });
    });

    it('should delegate markRead to provider', async () => {
      chatsProviderMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });

      await expect(messagesController.markRead(1, '5')).resolves.toBeUndefined();
      expect(chatsProviderMock.markRead).toHaveBeenCalledWith(5);
    });

    it('should throw BadRequestException for non-numeric messageId', async () => {
      await expect(messagesController.markRead(1, 'abc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for float messageId', async () => {
      await expect(messagesController.markRead(1, '1.5')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for zero messageId', async () => {
      await expect(messagesController.markRead(1, '0')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for negative messageId', async () => {
      await expect(messagesController.markRead(1, '-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for empty messageId', async () => {
      await expect(messagesController.markRead(1, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return empty list matching message-list-empty parity contract', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesController.listMessages(1);
      // Regression: parity fixture message-list-empty.json
      expect(Object.keys(result).sort()).toEqual(['messages', 'page', 'perPage', 'totalCount']);
      expect(result.messages).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should return stable pagination defaults across calls', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const first = await messagesController.listMessages(1);
      const second = await messagesController.listMessages(999);
      expect(first.page).toBe(second.page);
      expect(first.perPage).toBe(second.perPage);
    });

    it('should parse page and perPage as integers from string query params', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesController.listMessages(1, '3', '15');
      expect(typeof result.page).toBe('number');
      expect(typeof result.perPage).toBe('number');
      expect(result.page).toBe(3);
      expect(result.perPage).toBe(15);
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

      const result = await notificationsController.listNotifications(1);
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
      const result = await notificationsController.getUnreadCount(1, mockRes as any);
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
      const result = await notificationsController.getUnreadCount(1, mockRes as any);
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
        notificationsController.markRead(1, 'test-nid'),
      ).resolves.toBeUndefined();
      expect(providerMock.markRead).toHaveBeenCalledWith('test-nid', {
        mode: 'none',
      });
    });

    it('should accept pagination query params without error', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });
      // Controller accepts page/perPage even though use case does not forward them yet
      const result = await notificationsController.listNotifications(1, '2', '10');
      expect(result).toEqual({ notifications: [], totalCount: 0 });
    });

    it('should return empty list matching notification-list-empty parity contract', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });
      const result = await notificationsController.listNotifications(1);
      // Regression: parity fixture notification-list-empty.json
      expect(Object.keys(result).sort()).toEqual(['notifications', 'totalCount']);
      expect(result.notifications).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should return empty list when provider returns null data', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });
      const result = await notificationsController.listNotifications(1);
      expect(result).toEqual({ notifications: [], totalCount: 0 });
    });

    it('should return empty list when provider returns error', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'Connection refused',
      });
      const result = await notificationsController.listNotifications(1);
      expect(result).toEqual({ notifications: [], totalCount: 0 });
    });

    it('should return populated list matching notification-list-basic parity contract', async () => {
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
      const result = await notificationsController.listNotifications(1);
      // Regression: parity fixture notification-list-basic.json
      expect(result.notifications).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      const n = result.notifications[0];
      expect(typeof n.nid).toBe('string');
      expect(typeof n.type).toBe('string');
      expect(typeof n.bodyShort).toBe('string');
      expect(typeof n.fromUid).toBe('number');
      expect(typeof n.datetime).toBe('number');
      expect(typeof n.read).toBe('boolean');
    });
  });

  describe('MessagesUseCase', () => {
    it('should send message via provider', async () => {
      chatsProviderMock.send.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { messageId: 50, roomId: 5, fromUid: 1, content: 'test', timestamp: 1700000000 },
        error: null,
      });

      const result = await messagesUseCase.sendMessage(1, { toUid: 2, content: 'test', roomId: 5 });
      expect(result.fromUid).toBe(1);
      expect(result.toUid).toBe(2);
      expect(result.content).toBe('test');
      expect(result.read).toBe(false);
    });

    it('should create room when no roomId provided', async () => {
      chatsProviderMock.createRoom.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { roomId: 20, uids: [1, 2], owner: 1 },
        error: null,
      });

      const result = await messagesUseCase.sendMessage(1, { toUid: 2, content: 'hello' });
      expect(result.fromUid).toBe(1);
      expect(result.toUid).toBe(2);
      expect(chatsProviderMock.createRoom).toHaveBeenCalled();
    });

    it('should return mapped messages from chat rooms', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { roomId: 1, uids: [1, 2], owner: 1, lastMessage: { content: 'hi', timestamp: 1700000000, fromUid: 2 }, unread: 0 },
        ],
        error: null,
      });

      const result = await messagesUseCase.listMessages(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('hi');
      expect(result.messages[0].read).toBe(true);
      expect(result.totalCount).toBe(1);
    });

    it('should return empty list when provider returns empty rooms', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesUseCase.listMessages(1);
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 1,
        perPage: 20,
      });
    });

    it('should forward custom pagination values', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesUseCase.listMessages(1, 3, 15);
      expect(result).toEqual({
        messages: [],
        totalCount: 0,
        page: 3,
        perPage: 15,
      });
    });

    it('should return response matching parity schema shape', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesUseCase.listMessages(1);
      expect(Array.isArray(result.messages)).toBe(true);
      expect(typeof result.totalCount).toBe('number');
      expect(typeof result.page).toBe('number');
      expect(typeof result.perPage).toBe('number');
      expect(result.totalCount).toBeGreaterThanOrEqual(0);
      expect(result.page).toBeGreaterThanOrEqual(1);
      expect(result.perPage).toBeGreaterThanOrEqual(1);
      expect(result.perPage).toBeLessThanOrEqual(50);
    });

    it('should delegate markRead to provider', async () => {
      chatsProviderMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });

      await expect(messagesUseCase.markRead(1, 5)).resolves.toBeUndefined();
      expect(chatsProviderMock.markRead).toHaveBeenCalledWith(5);
    });

    it('should return response with exactly four keys matching parity contract', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesUseCase.listMessages(1);
      expect(Object.keys(result).sort()).toEqual(['messages', 'page', 'perPage', 'totalCount']);
    });

    it('should return stable pagination defaults on repeated calls', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const first = await messagesUseCase.listMessages(1);
      const second = await messagesUseCase.listMessages(2);
      expect(first.page).toBe(second.page);
      expect(first.perPage).toBe(second.perPage);
      expect(first.messages).toEqual(second.messages);
      expect(first.totalCount).toBe(second.totalCount);
    });

    it('should return non-negative totalCount and positive page/perPage for defaults', async () => {
      chatsProviderMock.listRooms.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await messagesUseCase.listMessages(1);
      expect(result.totalCount).toBeGreaterThanOrEqual(0);
      expect(result.page).toBeGreaterThanOrEqual(1);
      expect(result.perPage).toBeGreaterThanOrEqual(1);
      expect(result.perPage).toBeLessThanOrEqual(50);
    });

    it('should send message via provider across calls (message-send parity)', async () => {
      chatsProviderMock.send.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { messageId: 1, roomId: 1, fromUid: 1, content: 'a', timestamp: 1700000000 },
        error: null,
      });

      await expect(
        messagesUseCase.sendMessage(1, { toUid: 2, content: 'a', roomId: 1 }),
      ).resolves.toBeDefined();
    });

    it('should delegate markRead to provider across calls (message-mark-read parity)', async () => {
      chatsProviderMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });

      await expect(messagesUseCase.markRead(1, 1)).resolves.toBeUndefined();
      await expect(messagesUseCase.markRead(99, 999)).resolves.toBeUndefined();
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

    it('should return response matching notification-list-empty parity contract', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });
      const result = await notificationsUseCase.listNotifications(1);
      // Regression: parity fixture notification-list-empty.json
      expect(Object.keys(result).sort()).toEqual(['notifications', 'totalCount']);
      expect(result.notifications).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should return field types matching notification-list-basic parity contract', async () => {
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
      const n = result.notifications[0];
      // Regression: parity fixture notification-list-basic.json field types
      expect(typeof n.nid).toBe('string');
      expect(typeof n.type).toBe('string');
      expect(typeof n.bodyShort).toBe('string');
      expect(typeof n.fromUid).toBe('number');
      expect(typeof n.datetime).toBe('number');
      expect(typeof n.read).toBe('boolean');
      expect(result.totalCount).toBe(1);
    });

    it('should return count 0 for getUnreadCount when all notifications are read', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { nid: '1', type: 'test', bodyShort: 'a', nidFrom: 1, datetime: 0, read: true },
          { nid: '2', type: 'test', bodyShort: 'b', nidFrom: 2, datetime: 0, read: true },
        ],
        error: null,
      });
      const result = await notificationsUseCase.getUnreadCount(1);
      expect(result).toEqual({ count: 0, fallback: false });
    });

    it('should return total count for getUnreadCount when all notifications are unread', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { nid: '1', type: 'test', bodyShort: 'a', nidFrom: 1, datetime: 0, read: false },
          { nid: '2', type: 'test', bodyShort: 'b', nidFrom: 2, datetime: 0, read: false },
          { nid: '3', type: 'test', bodyShort: 'c', nidFrom: 3, datetime: 0, read: false },
        ],
        error: null,
      });
      const result = await notificationsUseCase.getUnreadCount(1);
      expect(result).toEqual({ count: 3, fallback: false });
    });

    it('should handle notification with optional bodyLong undefined', async () => {
      providerMock.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          {
            nid: 'notif-no-body',
            type: 'upvote',
            bodyShort: 'Someone upvoted',
            nidFrom: 10,
            datetime: 1700000000000,
            read: true,
          },
        ],
        error: null,
      });
      const result = await notificationsUseCase.listNotifications(1);
      expect(result.notifications[0].bodyLong).toBeUndefined();
      expect(result.notifications[0].fromUid).toBe(10);
    });
  });
});
