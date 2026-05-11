import { Injectable } from '@nestjs/common';
import type { CurrentUserDto } from '../dto';

export interface CurrentUserInput {
  userId: string;
}

@Injectable()
export class CurrentUserUsecase {
  async execute(_input: CurrentUserInput): Promise<CurrentUserDto> {
    throw new Error('CurrentUserUsecase not implemented — skeleton only');
  }
}
