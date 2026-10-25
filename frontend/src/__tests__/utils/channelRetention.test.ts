import { describe, it, expect } from "vitest";
import { describeChannelRetention } from "../../utils/channelRetention";

describe("describeChannelRetention", () => {
  it("returns null for a normal channel", () => {
    expect(describeChannelRetention(undefined)).toBeNull();
    expect(describeChannelRetention({})).toBeNull();
    expect(describeChannelRetention({ messageRetentionDays: null, fileRetentionDays: null })).toBeNull();
  });

  it("describes both periods", () => {
    expect(describeChannelRetention({ messageRetentionDays: 30, fileRetentionDays: 15 })).toBe(
      "Disappearing channel: messages are deleted after 30 days, shared files after 15 days",
    );
  });

  it("describes messages only", () => {
    expect(describeChannelRetention({ messageRetentionDays: 7, fileRetentionDays: null })).toBe(
      "Disappearing channel: messages are deleted after 7 days",
    );
  });

  it("describes files only and singularises one day", () => {
    expect(describeChannelRetention({ fileRetentionDays: 1 })).toBe(
      "Shared files in this channel are deleted after 1 day",
    );
  });
});
