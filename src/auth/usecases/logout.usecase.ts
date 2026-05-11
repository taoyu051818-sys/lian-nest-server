import { Injectable } from '@nestjs/common';

@Injectable()
export class LogoutUsecase {
  async execute(_sessionId: string): Promise<void> {
    throw new Error('LogoutUsecase.execute() not implemented — pending Slice 5');
  }
}
