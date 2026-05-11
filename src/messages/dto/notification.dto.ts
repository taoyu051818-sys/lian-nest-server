import { IsString, IsNumber, IsBoolean, IsOptional } from 'class-validator';

export class NotificationResponseDto {
  @IsString()
  nid: string;

  @IsString()
  type: string;

  @IsString()
  bodyShort: string;

  @IsOptional()
  @IsString()
  bodyLong?: string;

  @IsNumber()
  fromUid: number;

  @IsNumber()
  datetime: number;

  @IsBoolean()
  read: boolean;
}

export class NotificationListResponseDto {
  notifications: NotificationResponseDto[];
  totalCount: number;
}

export class MarkNotificationReadDto {
  @IsString()
  nid: string;
}
