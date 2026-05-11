import { AuthTokensDto } from './auth-tokens.dto';
import { CurrentUserDto } from './current-user.dto';

export interface LoginInput {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

export interface LoginOutput {
  user: CurrentUserDto;
  tokens: AuthTokensDto;
}

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  ip: string | null;
  userAgent: string | null;
}

export interface ChangePasswordInput {
  userId: number;
  currentPassword: string;
  newPassword: string;
}

export interface CurrentUserInput {
  userId: number;
}
