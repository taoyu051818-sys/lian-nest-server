import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  ok: true;
  status: string;
  timestamp: string;
  uptime: number;
}

@Controller('api/health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      ok: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
