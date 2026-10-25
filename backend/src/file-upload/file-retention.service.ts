import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ResourceType } from '@prisma/client';
import { DatabaseService } from '@/database/database.service';
import { StorageQuotaService } from '@/storage-quota/storage-quota.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MIN_SIZE_BYTES = 25 * 1024 * 1024;
const BATCH_SIZE = 500;

/**
 * Expires large chat attachments so uploads can't fill the disk. Messages stay;
 * only attachments at or above the size threshold and older than the retention
 * window are removed. Rows are soft-deleted here and the existing
 * FileService.cleanupOldFiles job removes them from storage.
 *
 * Env: FILE_RETENTION_DAYS (default 30, 0 disables),
 * FILE_RETENTION_MIN_SIZE_MB (default 25).
 */
@Injectable()
export class FileRetentionService {
  private readonly logger = new Logger(FileRetentionService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly storageQuotaService: StorageQuotaService,
    private readonly configService: ConfigService,
  ) {}

  private readNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredLargeAttachments(): Promise<number> {
    const days = this.readNumber('FILE_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
    if (days <= 0) return 0;
    const minSize = Math.round(
      this.readNumber('FILE_RETENTION_MIN_SIZE_MB', DEFAULT_MIN_SIZE_BYTES / 1048576) *
        1048576,
    );
    const cutoff = new Date(Date.now() - days * DAY_MS);

    let total = 0;
    for (;;) {
      const expired = await this.databaseService.file.findMany({
        where: {
          resourceType: ResourceType.MESSAGE_ATTACHMENT,
          deletedAt: null,
          uploadedAt: { lt: cutoff },
          size: { gte: minSize },
        },
        select: { id: true, size: true, uploadedById: true },
        take: BATCH_SIZE,
      });
      if (expired.length === 0) break;

      await this.databaseService.file.updateMany({
        where: { id: { in: expired.map((f) => f.id) }, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      const bytesByUser = new Map<string, number>();
      for (const file of expired) {
        if (!file.uploadedById || !file.size) continue;
        bytesByUser.set(
          file.uploadedById,
          (bytesByUser.get(file.uploadedById) ?? 0) + file.size,
        );
      }
      for (const [userId, bytes] of bytesByUser) {
        await this.storageQuotaService.decrementUserStorage(userId, bytes);
      }

      total += expired.length;
      if (expired.length < BATCH_SIZE) break;
    }

    if (total > 0) {
      this.logger.log(
        `Retention: expired ${total} attachment(s) of ${Math.round(minSize / 1048576)} MB+ older than ${days} days`,
      );
    }
    return total;
  }
}
