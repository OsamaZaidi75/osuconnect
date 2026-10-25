import { ConfigService } from '@nestjs/config';
import { ResourceType } from '@prisma/client';
import { FileRetentionService } from './file-retention.service';

describe('FileRetentionService', () => {
  const findMany = jest.fn();
  const updateMany = jest.fn();
  const decrementUserStorage = jest.fn();
  const env: Record<string, string | undefined> = {};

  const build = () =>
    new FileRetentionService(
      { file: { findMany, updateMany } } as never,
      { decrementUserStorage } as never,
      { get: (key: string) => env[key] } as unknown as ConfigService,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    Object.keys(env).forEach((key) => delete env[key]);
  });

  it('expires large old attachments and frees each uploader quota', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'f1', size: 30_000_000, uploadedById: 'u1' },
      { id: 'f2', size: 40_000_000, uploadedById: 'u1' },
      { id: 'f3', size: 50_000_000, uploadedById: 'u2' },
    ]);
    updateMany.mockResolvedValue({ count: 3 });

    const count = await build().purgeExpiredLargeAttachments();

    expect(count).toBe(3);
    const where = findMany.mock.calls[0][0].where;
    expect(where.resourceType).toBe(ResourceType.MESSAGE_ATTACHMENT);
    expect(where.deletedAt).toBeNull();
    expect(where.size).toEqual({ gte: 25 * 1048576 });
    const ageMs = Date.now() - where.uploadedAt.lt.getTime();
    expect(ageMs).toBeGreaterThan(29.9 * 86400000);
    expect(ageMs).toBeLessThan(30.1 * 86400000);
    expect(updateMany.mock.calls[0][0].where.id).toEqual({
      in: ['f1', 'f2', 'f3'],
    });
    expect(decrementUserStorage).toHaveBeenCalledWith('u1', 70_000_000);
    expect(decrementUserStorage).toHaveBeenCalledWith('u2', 50_000_000);
  });

  it('does nothing when retention is disabled', async () => {
    env.FILE_RETENTION_DAYS = '0';

    expect(await build().purgeExpiredLargeAttachments()).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does nothing when no files are expired', async () => {
    findMany.mockResolvedValueOnce([]);

    expect(await build().purgeExpiredLargeAttachments()).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(decrementUserStorage).not.toHaveBeenCalled();
  });
});
