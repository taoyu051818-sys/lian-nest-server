import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '../config';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoginUsecase } from './usecases/login.usecase';
import { RegisterUsecase } from './usecases/register.usecase';
import { LogoutUsecase } from './usecases/logout.usecase';
import { CurrentUserUsecase } from './usecases/current-user.usecase';
import { ChangePasswordUsecase } from './usecases/change-password.usecase';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.jwtSecret,
        signOptions: {
          expiresIn: configService.jwtExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    LoginUsecase,
    RegisterUsecase,
    LogoutUsecase,
    CurrentUserUsecase,
    ChangePasswordUsecase,
  ],
  exports: [
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    JwtModule,
    LoginUsecase,
    RegisterUsecase,
    LogoutUsecase,
    CurrentUserUsecase,
    ChangePasswordUsecase,
  ],
})
export class AuthModule {}
