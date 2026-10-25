import { ChannelPreset, ChannelType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import {
  ChannelPresetValues,
  ChannelTypeValues,
} from '@/common/enums/swagger-enums';

export class ChannelDto {
  id: string;
  name: string;
  communityId: string;
  createdAt: Date;
  @ApiProperty({ enum: ChannelTypeValues })
  type: ChannelType;
  position: number;
  slowmodeSeconds: number;
  /** Disappearing channel: messages older than this many days are deleted. */
  @ApiProperty({ type: Number, nullable: true })
  messageRetentionDays: number | null;
  /** Disappearing channel: attachments older than this many days are wiped. */
  @ApiProperty({ type: Number, nullable: true })
  fileRetentionDays: number | null;
  isPrivate: boolean;
  /** Display label for the permission preset (enforcement uses overwrites). */
  @ApiProperty({ enum: ChannelPresetValues })
  preset: ChannelPreset;
}
