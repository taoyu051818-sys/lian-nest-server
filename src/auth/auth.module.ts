import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LoginUsecase } from './usecases/login.usecase';
import { RegisterUsecase } from './usecases/register.usecase';
import { LogoutUsecase } from './usecases/logout.usecase';
import { CurrentUserUsecase } from './usecases/current-user.usecase';
import { ChangePasswordUsecase } from './usecases/change-password.usecase';

@Module({
  controllers: [AuthController],
  providers: [
    LoginUsecase,
    RegisterUsecase,
    LogoutUsecase,
    CurrentUserUsecase,
    ChangePasswordUsecase,
  ],
  exports: [
    LoginUsecase,
    RegisterUsecase,
    LogoutUsecase,
    CurrentUserUsecase,
    ChangePasswordUsecase,
  ],
})
export class AuthModule {}
