import { Injectable } from '@nestjs/common';
import { ChangePasswordInput } from '../dto/internal.dto';

@Injectable()
export class ChangePasswordUsecase {
  async execute(_input: ChangePasswordInput): Promise<void> {
    throw new Error('ChangePasswordUsecase.execute() not implemented — pending Slice 5');
  }
}
