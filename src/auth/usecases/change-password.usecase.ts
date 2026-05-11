import { Injectable } from '@nestjs/common';

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

@Injectable()
export class ChangePasswordUsecase {
  async execute(_input: ChangePasswordInput): Promise<void> {
    throw new Error('ChangePasswordUsecase not implemented — skeleton only');
  }
}
