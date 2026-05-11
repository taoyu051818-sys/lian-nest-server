import { Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { MessagesUseCase } from '../use-cases/messages.use-case';
import { CreateMessageDto, MessageResponseDto, MessageListResponseDto } from '../dto/message.dto';
import { JwtAuthGuard, CurrentUser } from '../../auth';

@Controller('api/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesUseCase: MessagesUseCase) {}

  @Post()
  async sendMessage(
    @Body() dto: CreateMessageDto,
    @CurrentUser('sub') fromUid: number,
  ): Promise<MessageResponseDto> {
    return this.messagesUseCase.sendMessage(fromUid, dto);
  }

  @Get()
  async listMessages(
    @CurrentUser('sub') uid: number,
    @Query('page') page = '1',
    @Query('perPage') perPage = '20',
  ): Promise<MessageListResponseDto> {
    return this.messagesUseCase.listMessages(uid, parseInt(page), parseInt(perPage));
  }

  @Post(':messageId/read')
  async markRead(
    @CurrentUser('sub') uid: number,
    @Param('messageId') messageId: string,
  ): Promise<void> {
    const trimmed = messageId.trim();
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
      throw new BadRequestException('Invalid messageId: must be a positive integer');
    }
    return this.messagesUseCase.markRead(uid, parsed);
  }
}
