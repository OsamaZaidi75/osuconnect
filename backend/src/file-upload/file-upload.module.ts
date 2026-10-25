import { Module } from '@nestjs/common';
import { FileUploadService } from './file-upload.service';
import { FileUploadController } from './file-upload.controller';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { StorageModule } from '@/storage/storage.module';
import { StorageQuotaModule } from '@/storage-quota/storage-quota.module';
import { LivekitModule } from '@/livekit/livekit.module';
import { ThumbnailService } from '@/file/thumbnail.service';
import { ThumbnailBackfillService } from '@/file/thumbnail-backfill.service';
import { FileRetentionService } from './file-retention.service';
import { TieredDiskStorage } from './tiered-disk-storage';

@Module({
  controllers: [FileUploadController],
  providers: [
    FileUploadService,
    ThumbnailService,
    ThumbnailBackfillService,
    FileRetentionService,
  ],
  exports: [FileUploadService],
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const primaryDir =
          configService.get<string>('FILE_UPLOAD_DEST') || './uploads';
        const fallbackDir = configService.get<string>(
          'FILE_UPLOAD_FALLBACK_DEST',
        );
        const limits = {
          fileSize: 1024 * 1024 * 1024, // 1GB hard limit (per-type limits enforced by validation strategies)
        };

        // Without a fallback directory, uploads go straight to FILE_UPLOAD_DEST.
        if (!fallbackDir) return { dest: primaryDir, limits };

        return {
          limits,
          storage: new TieredDiskStorage({
            primaryDir,
            fallbackDir,
            primaryMarker:
              configService.get<string>('FILE_UPLOAD_PRIMARY_MARKER') ||
              undefined,
            minFreeBytes:
              Number(
                configService.get<string>('FILE_UPLOAD_PRIMARY_MIN_FREE_MB') ||
                  1024,
              ) *
              1024 *
              1024,
          }),
        };
      },
      inject: [ConfigService],
    }),
    ConfigModule,
    DatabaseModule,
    StorageModule,
    StorageQuotaModule,
    LivekitModule,
  ],
})
export class FileUploadModule {}
