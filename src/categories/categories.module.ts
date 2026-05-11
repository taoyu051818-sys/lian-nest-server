import { Module } from '@nestjs/common';
import { NodebbModule } from '../nodebb/nodebb.module';
import { toNodebbAuthMode } from '../nodebb/types';
import { CategoriesController } from './categories.controller';
import { CategoriesUsecase } from './categories.usecase';

@Module({
  imports: [
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL || 'http://localhost:4567',
      authMode: toNodebbAuthMode(process.env.NODEBB_AUTH_MODE ?? 'none'),
      apiToken: process.env.NODEBB_API_TOKEN,
      sessionCookie: process.env.NODEBB_SESSION_COOKIE,
    }),
  ],
  controllers: [CategoriesController],
  providers: [CategoriesUsecase],
  exports: [CategoriesUsecase],
})
export class CategoriesModule {}
