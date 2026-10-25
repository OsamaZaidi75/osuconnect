import {
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(21600) // Max 6 hours
  slowmodeSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  messageRetentionDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  fileRetentionDays?: number | null;
}
