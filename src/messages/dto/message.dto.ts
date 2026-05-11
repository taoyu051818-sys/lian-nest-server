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
  @IsString()
  messageId: string;

  @IsNumber()
  fromUid: number;

  @IsNumber()
  toUid: number;

  @IsString()
  content: string;

  @IsString()
  timestamp: string;

  @IsBoolean()
  read: boolean;
}

export class MessageListResponseDto {
  messages: MessageResponseDto[];
  totalCount: number;
  page: number;
  perPage: number;
}
