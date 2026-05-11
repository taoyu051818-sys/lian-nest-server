import { Module } from '@nestjs/common';
import { NodebbModule } from '../nodebb/nodebb.module';
import { toNodebbAuthMode } from '../nodebb/types';
import { UsersController } from './users.controller';
import { UsersUsecase } from './users.usecase';

@Module({
  imports: [
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL || 'http://localhost:4567',
      authMode: toNodebbAuthMode(
        process.env.NODEBB_AUTH_MODE ?? 'none',
      ),
      apiToken: process.env.NODEBB_API_TOKEN,
      sessionCookie: process.env.NODEBB_SESSION_COOKIE,
    }),
  ],
  controllers: [UsersController],
  providers: [UsersUsecase],
  exports: [UsersUsecase],
})
export class UsersModule {}
