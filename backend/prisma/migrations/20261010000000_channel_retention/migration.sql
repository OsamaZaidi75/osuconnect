-- Disappearing channels: optional per-channel retention for messages and files.
-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "fileRetentionDays" INTEGER,
ADD COLUMN     "messageRetentionDays" INTEGER;
