import { Injectable } from '@nestjs/common';
import { RegisterInput, LoginOutput } from '../dto/internal.dto';

@Injectable()
export class RegisterUsecase {
  async execute(_input: RegisterInput): Promise<LoginOutput> {
    throw new Error('RegisterUsecase.execute() not implemented — pending Slice 4');
  }
}
