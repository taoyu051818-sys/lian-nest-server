import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './controllers/messages.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { MessagesUseCase } from './use-cases/messages.use-case';
import { NotificationsUseCase } from './use-cases/notifications.use-case';

describe('MessagesModule', () => {
  let module: TestingModule;
  let messagesController: MessagesController;
  let notificationsController: NotificationsController;
  let messagesUseCase: MessagesUseCase;
  let notificationsUseCase: NotificationsUseCase;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [MessagesController, NotificationsController],
      providers: [MessagesUseCase, NotificationsUseCase],
    }).compile();

    messagesController = module.get<MessagesController>(MessagesController);
    notificationsController = module.get<NotificationsController>(NotificationsController);
    messagesUseCase = module.get<MessagesUseCase>(MessagesUseCase);
    notificationsUseCase = module.get<NotificationsUseCase>(NotificationsUseCase);
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
    it('should throw not implemented for listNotifications', async () => {
      await expect(notificationsController.listNotifications()).rejects.toThrow(
        'Not implemented: NotificationsUseCase.listNotifications',
      );
    });

    it('should throw not implemented for getUnreadCount', async () => {
      await expect(notificationsController.getUnreadCount()).rejects.toThrow(
        'Not implemented: NotificationsUseCase.getUnreadCount',
      );
    });

    it('should throw not implemented for markRead', async () => {
      await expect(notificationsController.markRead('test-nid')).rejects.toThrow(
        'Not implemented: NotificationsUseCase.markRead',
      );
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
    it('should throw not implemented for listNotifications', async () => {
      await expect(notificationsUseCase.listNotifications(1)).rejects.toThrow(
        'Not implemented',
      );
    });

    it('should throw not implemented for markRead', async () => {
      await expect(notificationsUseCase.markRead(1, 'nid')).rejects.toThrow(
        'Not implemented',
      );
    });

    it('should throw not implemented for getUnreadCount', async () => {
      await expect(notificationsUseCase.getUnreadCount(1)).rejects.toThrow(
        'Not implemented',
      );
    });
  });
});
