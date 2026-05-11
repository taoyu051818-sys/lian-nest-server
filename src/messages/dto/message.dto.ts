import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';

export class CreateMessageDto {
  @IsNumber()
  toUid: number;

  @IsString()
  content: string;

  @IsOptional()
  @IsNumber()
  roomId?: number;
}

export class MessageResponseDto {
  @IsNumber()
  messageId: number;

  @IsNumber()
  fromUid: number;

  @IsNumber()
  toUid: number;

  @IsString()
  content: string;

  @IsNumber()
  timestamp: number;

  @IsBoolean()
  read: boolean;
}

export class MessageListResponseDto {
  messages: MessageResponseDto[];
  totalCount: number;
  page: number;
  perPage: number;
}
