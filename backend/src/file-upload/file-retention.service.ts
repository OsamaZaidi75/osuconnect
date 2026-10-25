import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, ResourceType } from '@prisma/client';
import { DatabaseService } from '@/database/database.service';
import { StorageQuotaService } from '@/storage-quota/storage-quota.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MIN_SIZE_BYTES = 25 * 1024 * 1024;
const BATCH_SIZE = 500;

/**
 * Keeps uploads and chat history from growing without bound. Rows are
 * soft-deleted here and FileService.cleanupOldFiles removes the bytes.
 *
 * - Global: MESSAGE_ATTACHMENT files at or above a size threshold and older
 *   than the retention window (env FILE_RETENTION_DAYS, default 30, 0
 *   disables; FILE_RETENTION_MIN_SIZE_MB, default 25).
 * - Per channel ("disappearing" channels): Channel.fileRetentionDays expires
 *   every attachment of any size, Channel.messageRetentionDays deletes the
 *   messages themselves.
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

  private async expireFiles(where: Prisma.FileWhereInput): Promise<number> {
    let total = 0;
    for (;;) {
      const expired = await this.databaseService.file.findMany({
        where: {
          resourceType: ResourceType.MESSAGE_ATTACHMENT,
          deletedAt: null,
          ...where,
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
    return total;
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredLargeAttachments(): Promise<number> {
    const days = this.readNumber('FILE_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
    if (days <= 0) return 0;
    const minSize = Math.round(
      this.readNumber(
        'FILE_RETENTION_MIN_SIZE_MB',
        DEFAULT_MIN_SIZE_BYTES / 1048576,
      ) * 1048576,
    );
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const total = await this.expireFiles({
      uploadedAt: { lt: cutoff },
      size: { gte: minSize },
    });

    if (total > 0) {
      this.logger.log(
        `Retention: expired ${total} attachment(s) of ${Math.round(minSize / 1048576)} MB+ older than ${days} days`,
      );
    }
    return total;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeDisappearingChannels(): Promise<{
    files: number;
    messages: number;
  }> {
    const channels = await this.databaseService.channel.findMany({
      where: {
        OR: [
          { fileRetentionDays: { not: null } },
          { messageRetentionDays: { not: null } },
        ],
      },
      select: {
        id: true,
        fileRetentionDays: true,
        messageRetentionDays: true,
      },
    });

    let files = 0;
    let messages = 0;
    for (const channel of channels) {
      if (channel.fileRetentionDays && channel.fileRetentionDays > 0) {
        files += await this.expireFiles({
          uploadedAt: {
            lt: new Date(Date.now() - channel.fileRetentionDays * DAY_MS),
          },
          messageAttachments: {
            some: { message: { channelId: channel.id } },
          },
        });
      }

      if (channel.messageRetentionDays && channel.messageRetentionDays > 0) {
        messages += await this.deleteOldMessages(
          channel.id,
          new Date(Date.now() - channel.messageRetentionDays * DAY_MS),
        );
      }
    }

    if (files > 0 || messages > 0) {
      this.logger.log(
        `Disappearing channels: expired ${files} file(s), deleted ${messages} message(s)`,
      );
    }
    return { files, messages };
  }

  /**
   * Hard-deletes old messages. A message is only removed once it has no
   * attachment rows left (so file bytes are never orphaned) and no thread
   * replies (the self-relation is NoAction); replies go first, parents on a
   * later pass or a later run.
   */
  private async deleteOldMessages(
    channelId: string,
    cutoff: Date,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const candidates = await this.databaseService.message.findMany({
        where: {
          channelId,
          sentAt: { lt: cutoff },
          attachments: { none: {} },
          threadReplies: { none: {} },
        },
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (candidates.length === 0) break;

      const { count } = await this.databaseService.message.deleteMany({
        where: { id: { in: candidates.map((m) => m.id) } },
      });
      total += count;
      if (count === 0) break;
    }
    return total;
  }
}
