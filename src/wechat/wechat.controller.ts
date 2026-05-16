import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { WechatService } from './wechat.service';

interface SignRequest {
  url: string;
}

@Controller('api/wechat')
export class WechatController {
  constructor(private readonly wechatService: WechatService) {}

  @Post('sign')
  @HttpCode(200)
  async sign(@Body() body: SignRequest) {
    return this.wechatService.sign(body.url);
  }
}
