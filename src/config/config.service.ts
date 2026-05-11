import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as Joi from 'joi';
import { envValidationSchema, EnvironmentVariables } from './env.validation';

dotenv.config();

export interface NodebbEnvConfig {
  url: string;
  authMode: string;
  apiToken: string;
  sessionCookie: string;
}

@Injectable()
export class ConfigService {
  private readonly env: EnvironmentVariables;

  constructor() {
    const { error, value } = envValidationSchema.validate(process.env, {
      allowUnknown: true,
      stripUnknown: false,
      abortEarly: false,
    });

    if (error) {
      const messages = error.details.map((d) => d.message).join('; ');
      throw new Error(`Environment validation failed: ${messages}`);
    }

    this.env = value;
  }

  get nodeEnv(): string {
    return this.env.NODE_ENV;
  }

  get port(): number {
    return this.env.PORT;
  }

  get logLevel(): string {
    return this.env.LOG_LEVEL;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get nodebbConfig(): NodebbEnvConfig {
    return {
      url: this.env.NODEBB_URL,
      authMode: this.env.NODEBB_AUTH_MODE,
      apiToken: this.env.NODEBB_API_TOKEN,
      sessionCookie: this.env.NODEBB_SESSION_COOKIE,
    };
  }
}
