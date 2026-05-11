import { LoginUsecase } from './login.usecase';
import { RegisterUsecase } from './register.usecase';
import { LogoutUsecase } from './logout.usecase';
import { CurrentUserUsecase } from './current-user.usecase';
import { ChangePasswordUsecase } from './change-password.usecase';

describe('Auth Usecases (skeleton)', () => {
  it('LoginUsecase.execute() should throw not-implemented', async () => {
    const usecase = new LoginUsecase();
    await expect(
      usecase.execute({ email: 'a@b.com', password: 'x', ip: null, userAgent: null }),
    ).rejects.toThrow('not implemented');
  });

  it('RegisterUsecase.execute() should throw not-implemented', async () => {
    const usecase = new RegisterUsecase();
    await expect(
      usecase.execute({ email: 'a@b.com', username: 'u', password: 'x', ip: null, userAgent: null }),
    ).rejects.toThrow('not implemented');
  });

  it('LogoutUsecase.execute() should throw not-implemented', async () => {
    const usecase = new LogoutUsecase();
    await expect(usecase.execute('session-id')).rejects.toThrow('not implemented');
  });

  it('CurrentUserUsecase.execute() should throw not-implemented', async () => {
    const usecase = new CurrentUserUsecase();
    await expect(usecase.execute({ userId: 1 })).rejects.toThrow('not implemented');
  });

  it('ChangePasswordUsecase.execute() should throw not-implemented', async () => {
    const usecase = new ChangePasswordUsecase();
    await expect(
      usecase.execute({ userId: 1, currentPassword: 'old', newPassword: 'new12345' }),
    ).rejects.toThrow('not implemented');
  });
});
