import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { LoginUsecase } from './usecases/login.usecase';
import { RegisterUsecase } from './usecases/register.usecase';
import { LogoutUsecase } from './usecases/logout.usecase';
import { CurrentUserUsecase } from './usecases/current-user.usecase';
import { ChangePasswordUsecase } from './usecases/change-password.usecase';

const mockLoginUsecase = { execute: jest.fn() };
const mockRegisterUsecase = { execute: jest.fn() };
const mockLogoutUsecase = { execute: jest.fn() };
const mockCurrentUserUsecase = { execute: jest.fn() };
const mockChangePasswordUsecase = { execute: jest.fn() };

describe('AuthController', () => {
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

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should delegate to LoginUsecase and return tokens', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresIn: 900 };
      const user = { id: 1, uuid: 'u', email: 'a@b.com', username: 'a', displayName: null, avatarUrl: null, role: 'USER', nodebbUid: null, createdAt: '2024-01-01' };
      mockLoginUsecase.execute.mockResolvedValue({ user, tokens });

      const result = await controller.login(
        { email: 'a@b.com', password: 'password123' },
        { ip: '127.0.0.1', headers: { 'user-agent': 'test' } },
      );

      expect(result).toEqual(tokens);
      expect(mockLoginUsecase.execute).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'password123',
        ip: '127.0.0.1',
        userAgent: 'test',
      });
    });
  });

  describe('register', () => {
    it('should delegate to RegisterUsecase and return tokens', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresIn: 900 };
      const user = { id: 1, uuid: 'u', email: 'a@b.com', username: 'newuser', displayName: null, avatarUrl: null, role: 'USER', nodebbUid: null, createdAt: '2024-01-01' };
      mockRegisterUsecase.execute.mockResolvedValue({ user, tokens });

      const result = await controller.register(
        { email: 'a@b.com', username: 'newuser', password: 'password123' },
        { ip: '127.0.0.1', headers: { 'user-agent': 'test' } },
      );

      expect(result).toEqual(tokens);
      expect(mockRegisterUsecase.execute).toHaveBeenCalledWith({
        email: 'a@b.com',
        username: 'newuser',
        password: 'password123',
        displayName: undefined,
        ip: '127.0.0.1',
        userAgent: 'test',
      });
    });
  });

  describe('logout', () => {
    it('should delegate to LogoutUsecase and return ok', async () => {
      mockLogoutUsecase.execute.mockResolvedValue(undefined);

      const result = await controller.logout({ sessionId: 'sess-1' });

      expect(result).toEqual({ ok: true });
      expect(mockLogoutUsecase.execute).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('me', () => {
    it('should delegate to CurrentUserUsecase and return user', async () => {
      const user = { id: 1, uuid: 'u', email: 'a@b.com', username: 'a', displayName: null, avatarUrl: null, role: 'USER', nodebbUid: null, createdAt: '2024-01-01' };
      mockCurrentUserUsecase.execute.mockResolvedValue(user);

      const result = await controller.me({ user: { id: 1 } });

      expect(result).toEqual(user);
      expect(mockCurrentUserUsecase.execute).toHaveBeenCalledWith({ userId: 1 });
    });
  });

  describe('changePassword', () => {
    it('should delegate to ChangePasswordUsecase', async () => {
      mockChangePasswordUsecase.execute.mockResolvedValue(undefined);

      await controller.changePassword(
        { currentPassword: 'old12345', newPassword: 'new12345' },
        { user: { id: 1 } },
      );

      expect(mockChangePasswordUsecase.execute).toHaveBeenCalledWith({
        userId: 1,
        currentPassword: 'old12345',
        newPassword: 'new12345',
      });
    });
  });
});
