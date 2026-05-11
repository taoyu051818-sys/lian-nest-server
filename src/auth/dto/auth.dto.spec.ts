import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';
import { ChangePasswordDto } from './change-password.dto';

describe('Auth DTOs', () => {
  describe('LoginDto', () => {
    it('should pass with valid data', async () => {
      const dto = plainToInstance(LoginDto, { email: 'user@example.com', password: 'password123' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail with invalid email', async () => {
      const dto = plainToInstance(LoginDto, { email: 'not-an-email', password: 'password123' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should fail with short password', async () => {
      const dto = plainToInstance(LoginDto, { email: 'user@example.com', password: 'short' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
    });

    it('should fail with missing fields', async () => {
      const dto = plainToInstance(LoginDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('RegisterDto', () => {
    it('should pass with valid data', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        username: 'newuser',
        password: 'password123',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass with optional displayName', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        username: 'newuser',
        password: 'password123',
        displayName: 'My Name',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail with too short username', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        username: 'ab',
        password: 'password123',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'username')).toBe(true);
    });

    it('should fail with too long username', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        username: 'a'.repeat(33),
        password: 'password123',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'username')).toBe(true);
    });

    it('should fail with short password', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        username: 'newuser',
        password: 'short',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });
  });

  describe('ChangePasswordDto', () => {
    it('should pass with valid data', async () => {
      const dto = plainToInstance(ChangePasswordDto, {
        currentPassword: 'oldpassword',
        newPassword: 'newpassword123',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail with short new password', async () => {
      const dto = plainToInstance(ChangePasswordDto, {
        currentPassword: 'oldpassword',
        newPassword: 'short',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
    });

    it('should fail with missing fields', async () => {
      const dto = plainToInstance(ChangePasswordDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
