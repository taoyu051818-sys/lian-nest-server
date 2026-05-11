import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { LoginUsecase } from './usecases/login.usecase';
import { RegisterUsecase } from './usecases/register.usecase';
import { LogoutUsecase } from './usecases/logout.usecase';
import { CurrentUserUsecase } from './usecases/current-user.usecase';
import { ChangePasswordUsecase } from './usecases/change-password.usecase';

/**
 * Controller session boundary regression tests.
 *
 * Validates request-to-usecase data flow at session boundaries:
 * - sessionId extraction for logout
 * - request metadata (ip, userAgent) forwarding for login/register
 * - unguarded /me and /password endpoints (known gap)
 * - missing request fields produce safe defaults
 *
 * Contract: docs/contracts/auth-session.md
 */

const mockLoginUsecase = { execute: jest.fn() };
const mockRegisterUsecase = { execute: jest.fn() };
const mockLogoutUsecase = { execute: jest.fn() };
const mockCurrentUserUsecase = { execute: jest.fn() };
const mockChangePasswordUsecase = { execute: jest.fn() };

describe('AuthController session boundary', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: LoginUsecase, useValue: mockLoginUsecase },
        { provide: RegisterUsecase, useValue: mockRegisterUsecase },
        { provide: LogoutUsecase, useValue: mockLogoutUsecase },
        { provide: CurrentUserUsecase, useValue: mockCurrentUserUsecase },
        { provide: ChangePasswordUsecase, useValue: mockChangePasswordUsecase },
      ],
    }).compile();

    controller = module.get(AuthController);
    jest.clearAllMocks();
  });

  describe('login: request metadata forwarding', () => {
    it('forwards ip and userAgent to LoginUsecase', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresIn: 900 };
      mockLoginUsecase.execute.mockResolvedValue({ user: {}, tokens });

      await controller.login(
        { email: 'a@b.com', password: 'pw123456' },
        { ip: '10.0.0.1', headers: { 'user-agent': 'Mozilla/5.0' } },
      );

      expect(mockLoginUsecase.execute).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'pw123456',
        ip: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
      });
    });

    it('defaults ip to null when req.ip is undefined', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresIn: 900 };
      mockLoginUsecase.execute.mockResolvedValue({ user: {}, tokens });

      await controller.login(
        { email: 'a@b.com', password: 'pw123456' },
        { headers: {} },
      );

      expect(mockLoginUsecase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ ip: null }),
      );
    });

    it('defaults userAgent to null when header is missing', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresIn: 900 };
      mockLoginUsecase.execute.mockResolvedValue({ user: {}, tokens });

      await controller.login(
        { email: 'a@b.com', password: 'pw123456' },
        { ip: '127.0.0.1', headers: {} },
      );

      expect(mockLoginUsecase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userAgent: null }),
      );
    });
  });

  describe('register: request metadata forwarding', () => {
    it('forwards ip, userAgent, and displayName to RegisterUsecase', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresIn: 900 };
      mockRegisterUsecase.execute.mockResolvedValue({ user: {}, tokens });

      await controller.register(
        { email: 'a@b.com', username: 'newuser', password: 'pw123456', displayName: 'Display' },
        { ip: '192.168.1.1', headers: { 'user-agent': 'curl/7' } },
      );

      expect(mockRegisterUsecase.execute).toHaveBeenCalledWith({
        email: 'a@b.com',
        username: 'newuser',
        password: 'pw123456',
        displayName: 'Display',
        ip: '192.168.1.1',
        userAgent: 'curl/7',
      });
    });

    it('forwards undefined displayName when not provided', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresIn: 900 };
      mockRegisterUsecase.execute.mockResolvedValue({ user: {}, tokens });

      await controller.register(
        { email: 'a@b.com', username: 'newuser', password: 'pw123456' },
        { ip: '127.0.0.1', headers: { 'user-agent': 'test' } },
      );

      expect(mockRegisterUsecase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: undefined }),
      );
    });
  });

  describe('logout: session ID extraction', () => {
    it('passes sessionId from request to LogoutUsecase', async () => {
      mockLogoutUsecase.execute.mockResolvedValue(undefined);

      const result = await controller.logout({ sessionId: 'sess-abc-123' });

      expect(result).toEqual({ ok: true });
      expect(mockLogoutUsecase.execute).toHaveBeenCalledWith('sess-abc-123');
    });

    it('defaults sessionId to empty string when not on request', async () => {
      mockLogoutUsecase.execute.mockResolvedValue(undefined);

      await controller.logout({});

      expect(mockLogoutUsecase.execute).toHaveBeenCalledWith('');
    });

    it('defaults sessionId to empty string when req has no sessionId property', async () => {
      mockLogoutUsecase.execute.mockResolvedValue(undefined);

      await controller.logout({ someOtherProp: 'value' });

      expect(mockLogoutUsecase.execute).toHaveBeenCalledWith('');
    });
  });

  describe('me: unguarded endpoint (known gap)', () => {
    it('passes userId from req.user.id to CurrentUserUsecase', async () => {
      const user = { id: 1, uuid: 'u', email: 'a@b.com', username: 'a', displayName: null, avatarUrl: null, role: 'USER' as const, nodebbUid: null, createdAt: '2024-01-01' };
      mockCurrentUserUsecase.execute.mockResolvedValue(user);

      const result = await controller.me({ user: { id: 42 } });

      expect(result).toEqual(user);
      expect(mockCurrentUserUsecase.execute).toHaveBeenCalledWith({ userId: 42 });
    });

    it('passes undefined userId when req.user is not set (no guard applied)', async () => {
      mockCurrentUserUsecase.execute.mockResolvedValue(null);

      await controller.me({});

      expect(mockCurrentUserUsecase.execute).toHaveBeenCalledWith({ userId: undefined });
    });

    it('passes undefined userId when req.user exists but has no id', async () => {
      mockCurrentUserUsecase.execute.mockResolvedValue(null);

      await controller.me({ user: {} });

      expect(mockCurrentUserUsecase.execute).toHaveBeenCalledWith({ userId: undefined });
    });
  });

  describe('changePassword: unguarded endpoint (known gap)', () => {
    it('passes userId from req.user.id to ChangePasswordUsecase', async () => {
      mockChangePasswordUsecase.execute.mockResolvedValue(undefined);

      await controller.changePassword(
        { currentPassword: 'old12345', newPassword: 'new12345' },
        { user: { id: 7 } },
      );

      expect(mockChangePasswordUsecase.execute).toHaveBeenCalledWith({
        userId: 7,
        currentPassword: 'old12345',
        newPassword: 'new12345',
      });
    });

    it('passes undefined userId when req.user is not set (no guard applied)', async () => {
      mockChangePasswordUsecase.execute.mockResolvedValue(undefined);

      await controller.changePassword(
        { currentPassword: 'old12345', newPassword: 'new12345' },
        {},
      );

      expect(mockChangePasswordUsecase.execute).toHaveBeenCalledWith({
        userId: undefined,
        currentPassword: 'old12345',
        newPassword: 'new12345',
      });
    });
  });
});
