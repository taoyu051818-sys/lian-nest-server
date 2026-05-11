import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { LoginUsecase, RegisterUsecase, LogoutUsecase, CurrentUserUsecase, ChangePasswordUsecase } from './usecases';
import type { LoginOutput } from './usecases';
import type { CurrentUserDto, AuthTokensDto } from './dto';
import { Reflector } from '@nestjs/core';

const mockTokens: AuthTokensDto = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 900,
};

const mockUser: CurrentUserDto = {
  id: 1,
  uuid: 'uuid-1',
  email: 'test@example.com',
  username: 'testuser',
  displayName: null,
  avatarUrl: null,
  role: 'USER',
  nodebbUid: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mockLoginOutput: LoginOutput = {
  user: mockUser,
  tokens: mockTokens,
};

const mockLoginUsecase = { execute: jest.fn().mockResolvedValue(mockLoginOutput) };
const mockRegisterUsecase = { execute: jest.fn().mockResolvedValue(mockLoginOutput) };
const mockLogoutUsecase = { execute: jest.fn().mockResolvedValue(undefined) };
const mockCurrentUserUsecase = { execute: jest.fn().mockResolvedValue(mockUser) };
const mockChangePasswordUsecase = { execute: jest.fn().mockResolvedValue(undefined) };

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
        Reflector,
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should return tokens on successful login', async () => {
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'test-agent' } } as any;
      const result = await controller.login({ email: 'a@b.com', password: 'password123' }, req);

      expect(result).toEqual(mockTokens);
      expect(mockLoginUsecase.execute).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'password123',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });
  });

  describe('register', () => {
    it('should return tokens on successful registration', async () => {
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'test-agent' } } as any;
      const result = await controller.register(
        { email: 'a@b.com', username: 'newuser', password: 'password123' },
        req,
      );

      expect(result).toEqual(mockTokens);
      expect(mockRegisterUsecase.execute).toHaveBeenCalledWith({
        email: 'a@b.com',
        username: 'newuser',
        password: 'password123',
        displayName: undefined,
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });
  });

  describe('logout', () => {
    it('should return ok: true on logout', async () => {
      const req = { user: { sessionId: 'sess-1' } } as any;
      const result = await controller.logout(req);

      expect(result).toEqual({ ok: true });
      expect(mockLogoutUsecase.execute).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('me', () => {
    it('should return the current user', async () => {
      const req = { user: { id: '1' } } as any;
      const result = await controller.me(req);

      expect(result).toEqual(mockUser);
      expect(mockCurrentUserUsecase.execute).toHaveBeenCalledWith({ userId: '1' });
    });
  });

  describe('changePassword', () => {
    it('should return ok: true on password change', async () => {
      const req = { user: { id: '1' } } as any;
      const result = await controller.changePassword(
        { currentPassword: 'old12345', newPassword: 'new12345' },
        req,
      );

      expect(result).toEqual({ ok: true });
      expect(mockChangePasswordUsecase.execute).toHaveBeenCalledWith({
        userId: '1',
        currentPassword: 'old12345',
        newPassword: 'new12345',
      });
    });
  });
});
