import { Test, TestingModule } from '@nestjs/testing';
import { AuthModule } from './auth.module';
import { AuthController } from './auth.controller';
import { LoginUsecase, RegisterUsecase, LogoutUsecase, CurrentUserUsecase, ChangePasswordUsecase } from './usecases';

describe('AuthModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
  });

  it('should compile the module', () => {
    expect(module).toBeDefined();
  });

  it('should provide AuthController', () => {
    const controller = module.get<AuthController>(AuthController);
    expect(controller).toBeDefined();
  });

  it('should provide all usecases', () => {
    expect(module.get(LoginUsecase)).toBeDefined();
    expect(module.get(RegisterUsecase)).toBeDefined();
    expect(module.get(LogoutUsecase)).toBeDefined();
    expect(module.get(CurrentUserUsecase)).toBeDefined();
    expect(module.get(ChangePasswordUsecase)).toBeDefined();
  });
});
