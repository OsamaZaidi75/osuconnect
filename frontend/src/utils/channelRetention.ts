export interface ChannelRetention {
  messageRetentionDays?: number | null;
  fileRetentionDays?: number | null;
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** A one-line, user-facing description of a disappearing channel, or null if it keeps everything. */
export function describeChannelRetention(channel?: ChannelRetention | null): string | null {
  const messages = channel?.messageRetentionDays;
  const files = channel?.fileRetentionDays;

  if (messages && files) {
    return `Disappearing channel: messages are deleted after ${days(messages)}, shared files after ${days(files)}`;
  }
  if (messages) return `Disappearing channel: messages are deleted after ${days(messages)}`;
  if (files) return `Shared files in this channel are deleted after ${days(files)}`;
  return null;
}
