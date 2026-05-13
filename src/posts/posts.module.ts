import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsUsecase } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsUsecase],
  exports: [PostsUsecase],
})
export class PostsModule {}
