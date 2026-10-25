import {
  IsOptional,
  IsInt,
  IsString,
  Length,
  Matches,
  Min,
  IsArray,
  IsDate,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInviteDto {
  /** A hand-picked code instead of a generated one (case-sensitive). */
  @IsOptional()
  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may only contain letters, numbers, underscores and hyphens',
  })
  code?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  validUntil?: Date;

  @IsArray()
  @IsUUID('all', { each: true })
  communityIds: string[];
}
