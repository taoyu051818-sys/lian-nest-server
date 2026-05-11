import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileUsecase } from './profile.usecase';

@Module({
  controllers: [ProfileController],
  providers: [ProfileUsecase],
  exports: [ProfileUsecase],
})
export class ProfileModule {}
