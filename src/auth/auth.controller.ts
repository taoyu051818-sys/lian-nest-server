import { Controller, Post, Get, Body, Req } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { CurrentUserDto } from './dto/current-user.dto';
import { LogoutDto } from './dto/logout.dto';
import { LoginUsecase } from './usecases/login.usecase';
import { RegisterUsecase } from './usecases/register.usecase';
import { LogoutUsecase } from './usecases/logout.usecase';
import { CurrentUserUsecase } from './usecases/current-user.usecase';
import { ChangePasswordUsecase } from './usecases/change-password.usecase';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly loginUsecase: LoginUsecase,
    private readonly registerUsecase: RegisterUsecase,
    private readonly logoutUsecase: LogoutUsecase,
    private readonly currentUserUsecase: CurrentUserUsecase,
    private readonly changePasswordUsecase: ChangePasswordUsecase,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any): Promise<AuthTokensDto> {
    const result = await this.loginUsecase.execute({
      email: dto.email,
      password: dto.password,
      ip: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    return result.tokens;
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: any): Promise<AuthTokensDto> {
    const result = await this.registerUsecase.execute({
      email: dto.email,
      username: dto.username,
      password: dto.password,
      displayName: dto.displayName,
      ip: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    return result.tokens;
  }

  @Post('logout')
  async logout(@Req() req: any): Promise<LogoutDto> {
    const sessionId = req.sessionId ?? '';
    await this.logoutUsecase.execute(sessionId);
    return { ok: true as const };
  }

  @Get('me')
  async me(@Req() req: any): Promise<CurrentUserDto> {
    const userId = req.user?.id;
    return this.currentUserUsecase.execute({ userId });
  }

  @Post('password')
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: any): Promise<void> {
    const userId = req.user?.id;
    return this.changePasswordUsecase.execute({
      userId,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }
}
