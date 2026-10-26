import { Prisma, ResourceType } from '@prisma/client';

/**
 * Hand over the files owned by messages that are about to be deleted, so that
 * their bytes get removed from storage.
 *
 * A message's own attachments are linked through `File.fileMessageId`, which
 * cascades: deleting the message makes the database delete those File rows.
 * The cleanup job (`FileService.cleanupOldFiles`) finds the bytes to remove
 * through File rows, so with the rows gone the bytes stay in storage forever.
 *
 * Call this in the same transaction, BEFORE the messages are deleted. It
 * detaches the files from their message (so the cascade no longer reaches
 * them), soft-deletes them (so the cleanup job removes bytes and rows) and
 * frees the uploaders' storage quota.
 *
 * Only message attachments are touched; avatars, emoji and clips are not.
 *
 * @param where which files, e.g. `{ fileMessageId: { in: ids } }` or
 *   `{ resourceMessage: { channelId } }`
 * @returns how many files were released
 */
export async function releaseOwnedFiles(
  tx: Prisma.TransactionClient,
  where: Prisma.FileWhereInput,
): Promise<number> {
  const owned = await tx.file.findMany({
    where: { AND: [where, { resourceType: ResourceType.MESSAGE_ATTACHMENT }] },
    select: { id: true, size: true, uploadedById: true, deletedAt: true },
  });
  if (owned.length === 0) return 0;

  // Quota was already freed when a file was soft-deleted earlier
  const active = owned.filter((file) => file.deletedAt === null);
  const alreadyDeleted = owned.filter((file) => file.deletedAt !== null);

  if (active.length > 0) {
    await tx.file.updateMany({
      where: { id: { in: active.map((file) => file.id) } },
      data: { fileMessageId: null, deletedAt: new Date() },
    });
  }
  if (alreadyDeleted.length > 0) {
    await tx.file.updateMany({
      where: { id: { in: alreadyDeleted.map((file) => file.id) } },
      data: { fileMessageId: null },
    });
  }

  const bytesByUser = new Map<string, number>();
  for (const file of active) {
    if (!file.uploadedById || !file.size) continue;
    bytesByUser.set(
      file.uploadedById,
      (bytesByUser.get(file.uploadedById) ?? 0) + file.size,
    );
  }
  for (const [userId, bytes] of bytesByUser) {
    await tx.$executeRaw`UPDATE "User" SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${BigInt(bytes)}) WHERE "id" = ${userId}`;
  }

  return owned.length;
}
