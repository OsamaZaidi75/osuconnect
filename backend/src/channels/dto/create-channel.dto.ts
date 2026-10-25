import { $Enums } from '@prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsInt,
  IsUUID,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ChannelTypeValues } from '@/common/enums/swagger-enums';

export class CreateChannelDto {
  @IsBoolean()
  @IsNotEmpty()
  isPrivate: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsUUID()
  communityId: string;

  @ApiProperty({ enum: ChannelTypeValues })
  @IsEnum($Enums.ChannelType)
  type: $Enums.ChannelType;

  @IsNumber()
  @IsOptional()
  position?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(21600) // Max 6 hours
  slowmodeSeconds?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(3650)
  messageRetentionDays?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(3650)
  fileRetentionDays?: number;
}
