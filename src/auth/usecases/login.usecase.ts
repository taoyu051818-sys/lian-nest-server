import { Injectable } from '@nestjs/common';
import type { CurrentUserDto } from '../dto';
import type { AuthTokensDto } from '../dto';

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

@Injectable()
export class LoginUsecase {
  async execute(_input: LoginInput): Promise<LoginOutput> {
    throw new Error('LoginUsecase not implemented — skeleton only');
  }
}
