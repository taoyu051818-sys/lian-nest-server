import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '../config';

interface CachedToken {
  value: string;
  expiresAt: number;
}

interface WechatAccessTokenResponse {
  access_token: string;
  expires_in: number;
  errcode?: number;
  errmsg?: string;
}

interface WechatTicketResponse {
  ticket: string;
  expires_in: number;
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);

  private accessToken: CachedToken | null = null;
  private jsapiTicket: CachedToken | null = null;

  constructor(private readonly config: ConfigService) {}

  async sign(url: string): Promise<{
    appId: string;
    timestamp: number;
    nonceStr: string;
    signature: string;
  }> {
    if (!this.config.wechatConfigured) {
      throw new ServiceUnavailableException('WeChat sharing is not configured');
    }

    const ticket = await this.getJsapiTicket();
    const timestamp = Math.floor(Date.now() / 1000);
    const nonceStr = randomBytes(16).toString('hex');

    // Strip hash from URL — WeChat signing requires the URL without fragment
    const signUrl = url.split('#')[0];

    const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${signUrl}`;
    const signature = createHash('sha1').update(raw).digest('hex');

    return {
      appId: this.config.wechatAppId,
      timestamp,
      nonceStr,
      signature,
    };
  }

  private async getJsapiTicket(): Promise<string> {
    if (this.jsapiTicket && Date.now() < this.jsapiTicket.expiresAt) {
      return this.jsapiTicket.value;
    }

    const token = await this.getAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${token}&type=jsapi`;

    const res = await fetch(url);
    const data: WechatTicketResponse = await res.json();

    if (data.errcode) {
      this.logger.error(`Failed to get jsapi_ticket: ${data.errcode} ${data.errmsg}`);
      this.jsapiTicket = null;
      throw new Error(`WeChat jsapi_ticket error: ${data.errmsg}`);
    }

    this.jsapiTicket = {
      value: data.ticket,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000, // 5 min buffer
    };

    return data.ticket;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt) {
      return this.accessToken.value;
    }

    const { wechatAppId, wechatAppSecret } = this.config;
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${wechatAppId}&secret=${wechatAppSecret}`;

    const res = await fetch(url);
    const data: WechatAccessTokenResponse = await res.json();

    if (data.errcode) {
      this.logger.error(`Failed to get access_token: ${data.errcode} ${data.errmsg}`);
      this.accessToken = null;
      throw new Error(`WeChat access_token error: ${data.errmsg}`);
    }

    this.accessToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000, // 5 min buffer
    };

    return data.access_token;
  }
}
