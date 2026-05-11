import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LoginUsecase, RegisterUsecase, LogoutUsecase, CurrentUserUsecase, ChangePasswordUsecase } from './usecases';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

const usecases = [
  LoginUsecase,
  RegisterUsecase,
  LogoutUsecase,
  CurrentUserUsecase,
  ChangePasswordUsecase,
];

@Module({
  controllers: [AuthController],
  providers: [...usecases, JwtAuthGuard, RolesGuard],
  exports: [...usecases],
})
export class AuthModule {}
