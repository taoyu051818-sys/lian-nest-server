import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationsUseCase } from './usecases/notifications.usecase';
import { NodebbNotificationsProvider, BodyStatus } from '../nodebb';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth';

describe('NotificationsController markRead edge coverage', () => {
  let module: TestingModule;
  let controller: NotificationsController;
  let useCase: NotificationsUseCase;

  const providerMock = {
    list: jest.fn(),
    markRead: jest.fn(),
  };

  beforeEach(async () => {
    providerMock.list.mockReset();
    providerMock.markRead.mockReset();

    module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        NotificationsUseCase,
        { provide: NodebbNotificationsProvider, useValue: providerMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
    useCase = module.get<NotificationsUseCase>(NotificationsUseCase);
  });

  describe('empty and whitespace nid rejection', () => {
    it('should throw BadRequestException for empty string nid', async () => {
      await expect(controller.markRead(1, '')).rejects.toThrow(
        BadRequestException,
      );
      expect(providerMock.markRead).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for whitespace-only nid', async () => {
      await expect(controller.markRead(1, '   ')).rejects.toThrow(
        BadRequestException,
      );
      expect(providerMock.markRead).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for tab-only nid', async () => {
      await expect(controller.markRead(1, '\t')).rejects.toThrow(
        BadRequestException,
      );
      expect(providerMock.markRead).not.toHaveBeenCalled();
    });
  });

  describe('provider NOT_FOUND mapping', () => {
    it('should throw NotFoundException when provider returns NOT_FOUND', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'Notification not found',
      });
      await expect(
        controller.markRead(1, 'missing-nid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should include nid in NotFoundException message', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'Notification not found',
      });
      await expect(
        controller.markRead(1, 'abc-123'),
      ).rejects.toThrow('Notification abc-123 not found');
    });
  });

  describe('provider ERROR mapping', () => {
    it('should throw Error with provider message when status is ERROR', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'NodeBB unreachable',
      });
      await expect(
        controller.markRead(1, 'test-nid'),
      ).rejects.toThrow('NodeBB unreachable');
    });

    it('should throw Error with fallback message when error is null', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: null,
      });
      await expect(
        controller.markRead(1, 'test-nid'),
      ).rejects.toThrow('Failed to mark notification as read');
    });
  });

  describe('success path', () => {
    it('should resolve with void on provider OK', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });
      const result = await controller.markRead(1, 'valid-nid');
      expect(result).toBeUndefined();
    });

    it('should pass nid and auth to provider', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });
      await controller.markRead(42, 'notif-xyz');
      expect(providerMock.markRead).toHaveBeenCalledWith('notif-xyz', {
        mode: 'none',
      });
    });
  });
});

describe('NotificationsUseCase markRead edge coverage', () => {
  let useCase: NotificationsUseCase;

  const providerMock = {
    list: jest.fn(),
    markRead: jest.fn(),
  };

  beforeEach(async () => {
    providerMock.list.mockReset();
    providerMock.markRead.mockReset();

    const module = await Test.createTestingModule({
      providers: [
        NotificationsUseCase,
        { provide: NodebbNotificationsProvider, useValue: providerMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    useCase = module.get<NotificationsUseCase>(NotificationsUseCase);
  });

  describe('nid validation', () => {
    it('should throw BadRequestException for empty string', async () => {
      await expect(useCase.markRead(1, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for whitespace-only', async () => {
      await expect(useCase.markRead(1, '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should not call provider when nid is empty', async () => {
      await useCase.markRead(1, '').catch(() => {});
      expect(providerMock.markRead).not.toHaveBeenCalled();
    });

    it('should not call provider when nid is whitespace', async () => {
      await useCase.markRead(1, '   ').catch(() => {});
      expect(providerMock.markRead).not.toHaveBeenCalled();
    });
  });

  describe('provider status mapping', () => {
    it('should throw NotFoundException for NOT_FOUND status', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'Notification not found',
      });
      await expect(useCase.markRead(1, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should include nid in NOT_FOUND error message', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'Notification not found',
      });
      await expect(useCase.markRead(1, 'n-42')).rejects.toThrow(
        'Notification n-42 not found',
      );
    });

    it('should throw Error with provider error string for ERROR status', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'Connection refused',
      });
      await expect(useCase.markRead(1, 'nid-1')).rejects.toThrow(
        'Connection refused',
      );
    });

    it('should use fallback message when error string is null', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: null,
      });
      await expect(useCase.markRead(1, 'nid-1')).rejects.toThrow(
        'Failed to mark notification as read',
      );
    });

    it('should resolve void for OK status', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });
      const result = await useCase.markRead(1, 'nid-ok');
      expect(result).toBeUndefined();
    });
  });

  describe('parity contract: notification-mark-read-edge', () => {
    it('empty-nid: BadRequestException with 400', async () => {
      await expect(useCase.markRead(1, '')).rejects.toThrow(
        BadRequestException,
      );
      expect(providerMock.markRead).not.toHaveBeenCalled();
    });

    it('whitespace-nid: BadRequestException with 400', async () => {
      await expect(useCase.markRead(1, '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('provider-not-found: NotFoundException with 404', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'Notification not found',
      });
      await expect(useCase.markRead(1, 'missing-nid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('provider-error-with-message: Error with provider message', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'NodeBB unreachable',
      });
      await expect(useCase.markRead(1, 'test-nid')).rejects.toThrow(
        'NodeBB unreachable',
      );
    });

    it('provider-error-null-message: Error with fallback message', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: null,
      });
      await expect(useCase.markRead(1, 'test-nid')).rejects.toThrow(
        'Failed to mark notification as read',
      );
    });

    it('success: resolves void', async () => {
      providerMock.markRead.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });
      await expect(useCase.markRead(1, 'valid-nid')).resolves.toBeUndefined();
    });
  });
});
