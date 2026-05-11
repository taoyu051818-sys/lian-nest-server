import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { LoginDto, RegisterDto, ChangePasswordDto, AuthTokensDto, CurrentUserDto } from './dto';
import { LoginUsecase, RegisterUsecase, LogoutUsecase, CurrentUserUsecase, ChangePasswordUsecase } from './usecases';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import type { AppRole } from './guards/roles.guard';

interface AuthenticatedUser {
  id?: string;
  sessionId?: string;
  role?: AppRole;
}

type AuthRequest = Request & { user?: AuthenticatedUser };

@Controller('api/auth')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuthController {
  constructor(
    private readonly loginUsecase: LoginUsecase,
    private readonly registerUsecase: RegisterUsecase,
    private readonly logoutUsecase: LogoutUsecase,
    private readonly currentUserUsecase: CurrentUserUsecase,
    private readonly changePasswordUsecase: ChangePasswordUsecase,
  ) {}

  @Post('login')
  @Public()
  async login(@Body() dto: LoginDto, @Req() req: AuthRequest): Promise<AuthTokensDto> {
    const result = await this.loginUsecase.execute({
      email: dto.email,
      password: dto.password,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return result.tokens;
  }

  @Post('register')
  @Public()
  async register(@Body() dto: RegisterDto, @Req() req: AuthRequest): Promise<AuthTokensDto> {
    const result = await this.registerUsecase.execute({
      email: dto.email,
      username: dto.username,
      password: dto.password,
      displayName: dto.displayName,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return result.tokens;
  }

  @Post('logout')
  async logout(@Req() req: AuthRequest): Promise<{ ok: true }> {
    const user = req.user;
    await this.logoutUsecase.execute(user?.sessionId ?? '');
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: AuthRequest): Promise<CurrentUserDto> {
    const user = req.user;
    return this.currentUserUsecase.execute({ userId: user?.id ?? '' });
  }

  @Post('password')
  @Roles('USER' as AppRole, 'MODERATOR' as AppRole, 'ADMIN' as AppRole)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthRequest): Promise<{ ok: true }> {
    const user = req.user;
    await this.changePasswordUsecase.execute({
      userId: user?.id ?? '',
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
    return { ok: true };
  }
}
