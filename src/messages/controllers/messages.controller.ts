import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { MessagesUseCase } from '../use-cases/messages.use-case';
import { CreateMessageDto, MessageResponseDto, MessageListResponseDto } from '../dto/message.dto';

@Controller('api/messages')
export class MessagesController {
  constructor(private readonly messagesUseCase: MessagesUseCase) {}

  @Post()
  async sendMessage(
    @Body() dto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    // TODO: Extract fromUid from auth context (session/JWT)
    const fromUid = 0;
    return this.messagesUseCase.sendMessage(fromUid, dto);
  }

  @Get()
  async listMessages(
    @Query('page') page = '1',
    @Query('perPage') perPage = '20',
  ): Promise<MessageListResponseDto> {
    // TODO: Extract uid from auth context (session/JWT)
    const uid = 0;
    return this.messagesUseCase.listMessages(uid, parseInt(page), parseInt(perPage));
  }

  @Post(':messageId/read')
  async markRead(@Param('messageId') messageId: string): Promise<void> {
    // TODO: Extract uid from auth context (session/JWT)
    const uid = 0;
    return this.messagesUseCase.markRead(uid, parseInt(messageId));
  }
}
