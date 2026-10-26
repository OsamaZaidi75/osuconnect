import { Prisma, ResourceType } from '@prisma/client';
import { releaseOwnedFiles } from './release-owned-files';

describe('releaseOwnedFiles', () => {
  const findMany = jest.fn();
  const updateMany = jest.fn();
  const executeRaw = jest.fn();
  const tx = {
    file: { findMany, updateMany },
    $executeRaw: executeRaw,
  } as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    jest.resetAllMocks();
    updateMany.mockResolvedValue({ count: 0 });
    executeRaw.mockResolvedValue(1);
  });

  it('does nothing when the messages own no files', async () => {
    findMany.mockResolvedValue([]);

    expect(
      await releaseOwnedFiles(tx, { fileMessageId: { in: ['m1'] } }),
    ).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('only selects message attachments matching the filter', async () => {
    findMany.mockResolvedValue([]);
    const where = { fileMessageId: { in: ['m1'] } };

    await releaseOwnedFiles(tx, where);

    expect(findMany.mock.calls[0][0].where).toEqual({
      AND: [where, { resourceType: ResourceType.MESSAGE_ATTACHMENT }],
    });
  });

  it('detaches and soft-deletes active files so the cleanup job can remove their bytes', async () => {
    findMany.mockResolvedValue([
      { id: 'f1', size: 100, uploadedById: 'u1', deletedAt: null },
      { id: 'f2', size: 200, uploadedById: 'u1', deletedAt: null },
    ]);

    expect(
      await releaseOwnedFiles(tx, { fileMessageId: { in: ['m1'] } }),
    ).toBe(2);

    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: { in: ['f1', 'f2'] } });
    expect(call.data.fileMessageId).toBeNull();
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it('detaches already soft-deleted files without touching their deletedAt', async () => {
    const deletedAt = new Date('2026-01-01');
    findMany.mockResolvedValue([
      { id: 'f1', size: 100, uploadedById: 'u1', deletedAt },
    ]);

    await releaseOwnedFiles(tx, { fileMessageId: { in: ['m1'] } });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['f1'] } },
      data: { fileMessageId: null },
    });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('frees quota once per uploader, only for files that were still active', async () => {
    findMany.mockResolvedValue([
      { id: 'f1', size: 100, uploadedById: 'u1', deletedAt: null },
      { id: 'f2', size: 200, uploadedById: 'u1', deletedAt: null },
      { id: 'f3', size: 50, uploadedById: 'u2', deletedAt: null },
      { id: 'f4', size: 999, uploadedById: 'u3', deletedAt: new Date() },
      { id: 'f5', size: 10, uploadedById: null, deletedAt: null },
    ]);

    await releaseOwnedFiles(tx, { fileMessageId: { in: ['m1'] } });

    expect(executeRaw).toHaveBeenCalledTimes(2);
    const amounts = executeRaw.mock.calls.map((call) => ({
      bytes: call[1] as bigint,
      user: call[2] as string,
    }));
    expect(amounts).toEqual([
      { bytes: BigInt(300), user: 'u1' },
      { bytes: BigInt(50), user: 'u2' },
    ]);
  });
});
