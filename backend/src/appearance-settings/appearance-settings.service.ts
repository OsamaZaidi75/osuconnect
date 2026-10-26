import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { UserAppearanceSettings } from '@prisma/client';
import { UpdateAppearanceSettingsDto } from './dto/update-appearance-settings.dto';

/** What a new account starts with (the schema's own defaults are blue / minimal). */
export const DEFAULT_APPEARANCE = {
  themeMode: 'dark',
  accentColor: 'violet',
  intensity: 'balanced',
} as const;

@Injectable()
export class AppearanceSettingsService {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Get user appearance settings (creates default if missing)
   */
  async getUserSettings(userId: string): Promise<UserAppearanceSettings> {
    return this.databaseService.userAppearanceSettings.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_APPEARANCE },
      update: {},
    });
  }

  /**
   * Update user appearance settings
   */
  async updateUserSettings(
    userId: string,
    dto: UpdateAppearanceSettingsDto,
  ): Promise<UserAppearanceSettings> {
    return this.databaseService.userAppearanceSettings.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_APPEARANCE, ...dto },
      update: dto,
    });
  }
}
