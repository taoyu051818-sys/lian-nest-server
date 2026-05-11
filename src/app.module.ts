import { Module } from '@nestjs/common';
import { CategoriesModule } from './categories';
import { ConfigModule, ConfigService } from './config';
import { HealthModule } from './health';
import { MessagesModule } from './messages';
import { NodebbModule } from './nodebb';
import { toNodebbAuthMode } from './nodebb/types';
import { PostsModule } from './posts';
import { ProfileModule } from './profile';
import { TagsModule } from './tags';
import { TopicsModule } from './topics';
import { UsersModule } from './users';

@Module({
  imports: [
    CategoriesModule,
    ConfigModule,
    HealthModule,
    MessagesModule,
    PostsModule,
    ProfileModule,
    TagsModule,
    TopicsModule,
    UsersModule,
    NodebbModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseUrl: config.nodebbConfig.url,
        authMode: toNodebbAuthMode(config.nodebbConfig.authMode),
        apiToken: config.nodebbConfig.apiToken || undefined,
        sessionCookie: config.nodebbConfig.sessionCookie || undefined,
      }),
    }),
  ],
})
export class AppModule {}
