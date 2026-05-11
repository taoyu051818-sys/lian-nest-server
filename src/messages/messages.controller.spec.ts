import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './controllers/messages.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { MessagesUseCase } from './use-cases/messages.use-case';
import { NotificationsUseCase } from './use-cases/notifications.use-case';
import { NodebbNotificationsProvider } from '../nodebb';
import { BodyStatus } from '../nodebb';

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

    it('should throw not implemented for listMessages', async () => {
      await expect(messagesController.listMessages()).rejects.toThrow(
        'Not implemented: MessagesUseCase.listMessages',
      );
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
      const result = await notificationsController.getUnreadCount();
      expect(result).toEqual({ count: 0 });
    });

    it('should throw not implemented for markRead', async () => {
      await expect(
        notificationsController.markRead('test-nid'),
      ).rejects.toThrow('Not implemented: NotificationsUseCase.markRead');
    });
  });

  describe('MessagesUseCase', () => {
    it('should throw not implemented for sendMessage', async () => {
      await expect(
        messagesUseCase.sendMessage(1, { toUid: 2, content: 'test' }),
      ).rejects.toThrow('Not implemented');
    });

    it('should throw not implemented for listMessages', async () => {
      await expect(messagesUseCase.listMessages(1)).rejects.toThrow(
        'Not implemented',
      );
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

    it('should return 0 for getUnreadCount', async () => {
      const count = await notificationsUseCase.getUnreadCount(1);
      expect(count).toBe(0);
    });

    it('should throw not implemented for markRead', async () => {
      await expect(
        notificationsUseCase.markRead(1, 'nid'),
      ).rejects.toThrow('Not implemented: NotificationsUseCase.markRead');
    });
  });
});
