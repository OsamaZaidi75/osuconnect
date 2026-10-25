import type { CommunityResponseDto } from "../api-client/types.gen";
import type { CreateInviteDto } from "../types/invite.type";

// Codes are short (4 digits), so quick invites stay small and short-lived.
export const QUICK_INVITE_MAX_USES = 5;
export const QUICK_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export const inviteUrl = (instanceUrl: string, code: string) => `${instanceUrl}/#/join/${code}`;

/** Prefer a community called "default", else every community you're in. */
export function buildQuickInviteBody(communities: CommunityResponseDto[]): CreateInviteDto {
  const defaultCommunity = communities.find((c) => c.name.toLowerCase() === "default");
  return {
    communityIds: defaultCommunity ? [defaultCommunity.id] : communities.map((c) => c.id),
    maxUses: QUICK_INVITE_MAX_USES,
    validUntil: new Date(Date.now() + QUICK_INVITE_TTL_MS).toISOString(),
  };
}
