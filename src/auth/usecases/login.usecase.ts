import { Injectable } from '@nestjs/common';
import { LoginInput, LoginOutput } from '../dto/internal.dto';

@Injectable()
export class LoginUsecase {
  async execute(_input: LoginInput): Promise<LoginOutput> {
    throw new Error('LoginUsecase.execute() not implemented — pending Slice 3');
  }
}
