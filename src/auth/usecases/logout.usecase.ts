import { Injectable } from '@nestjs/common';

@Injectable()
export class LogoutUsecase {
  async execute(_sessionId: string): Promise<void> {
    throw new Error('LogoutUsecase not implemented — skeleton only');
  }
}
