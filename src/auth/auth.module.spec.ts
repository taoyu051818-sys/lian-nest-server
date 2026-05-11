import { Test, TestingModule } from '@nestjs/testing';
import { AuthModule } from './auth.module';
import { AuthController } from './auth.controller';
import { LoginUsecase } from './usecases/login.usecase';
import { RegisterUsecase } from './usecases/register.usecase';
import { LogoutUsecase } from './usecases/logout.usecase';
import { CurrentUserUsecase } from './usecases/current-user.usecase';
import { ChangePasswordUsecase } from './usecases/change-password.usecase';

describe('AuthModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should compile the module', () => {
    expect(module).toBeDefined();
  });

  it('should provide AuthController', () => {
    const controller = module.get(AuthController);
    expect(controller).toBeDefined();
  });

  it('should provide LoginUsecase', () => {
    const usecase = module.get(LoginUsecase);
    expect(usecase).toBeDefined();
  });

  it('should provide RegisterUsecase', () => {
    const usecase = module.get(RegisterUsecase);
    expect(usecase).toBeDefined();
  });

  it('should provide LogoutUsecase', () => {
    const usecase = module.get(LogoutUsecase);
    expect(usecase).toBeDefined();
  });

  it('should provide CurrentUserUsecase', () => {
    const usecase = module.get(CurrentUserUsecase);
    expect(usecase).toBeDefined();
  });

  it('should provide ChangePasswordUsecase', () => {
    const usecase = module.get(ChangePasswordUsecase);
    expect(usecase).toBeDefined();
  });
});
