import { Injectable } from '@nestjs/common';
import { CurrentUserDto } from '../dto';
import { CurrentUserInput } from '../dto/internal.dto';

@Injectable()
export class CurrentUserUsecase {
  async execute(_input: CurrentUserInput): Promise<CurrentUserDto> {
    throw new Error('CurrentUserUsecase.execute() not implemented — pending Slice 5');
  }
}
