import { Injectable } from '@nestjs/common';
import type { LoginOutput } from './login.usecase';

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class RegisterUsecase {
  async execute(_input: RegisterInput): Promise<LoginOutput> {
    throw new Error('RegisterUsecase not implemented — skeleton only');
  }
}
