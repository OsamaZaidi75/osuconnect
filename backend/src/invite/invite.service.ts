import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { DatabaseService } from '@/database/database.service';
import { isPrismaError } from '@/common/utils/prisma.utils';
import { UserEntity } from '@/user/dto/user-response.dto';
import {
  InstanceInvite,
  InstanceInviteDefaultCommunity,
  InstanceInviteUsage,
  Prisma,
} from '@prisma/client';

const INVITE_CODE_DIGITS = 4;
const COLLISION_ATTEMPTS_PER_DIGIT = 20;

export type InstanceInviteWithRelations = InstanceInvite & {
  defaultCommunities: InstanceInviteDefaultCommunity[];
  usages: InstanceInviteUsage[];
};

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async createInvite(
    creator: UserEntity,
    maxUses?: number,
    validUntil?: Date,
    communityIds: string[] = [],
    customCode?: string,
  ): Promise<InstanceInviteWithRelations> {
    let shortCode: string;
    if (customCode) {
      shortCode = customCode;
      const taken = await this.databaseService.instanceInvite.findUnique({
        where: { code: shortCode },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException('That invite code is already in use');
      }
    } else {
      shortCode = await this.generateUniqueCode();
    }

    // Logic to create an invite for a user to join an instance
    try {
      return await this.databaseService.instanceInvite.create({
        data: {
          code: shortCode,
          createdById: creator.id,
          maxUses,
          validUntil,
          ...(communityIds.length > 0
            ? {
                defaultCommunities: {
                  create: communityIds.map((communityId) => ({ communityId })),
                },
              }
            : {}),
        },
        include: {
          defaultCommunities: true,
          usages: true,
        },
      });
    } catch (error) {
      if (customCode && isPrismaError(error, 'P2002')) {
        throw new ConflictException('That invite code is already in use');
      }
      throw error;
    }
  }

  private async generateUniqueCode(): Promise<string> {
    // generate a short numeric code for the invite
    let digits = INVITE_CODE_DIGITS;
    let attempts = 0;
    let shortCode = this.generateInviteCode(digits);
    // Check if the short code already exists
    while (
      await this.databaseService.instanceInvite.findFirst({
        where: { code: shortCode },
      })
    ) {
      // If it does, generate a new one; widen the code if the space is crowded
      this.logger.warn(`Short code ${shortCode} collision! Generating new one`);
      attempts++;
      if (attempts % COLLISION_ATTEMPTS_PER_DIGIT === 0) digits++;
      shortCode = this.generateInviteCode(digits);
    }
    return shortCode;
  }

  async validateInviteCode(
    inviteCode: string,
  ): Promise<InstanceInviteWithRelations | null> {
    const invite = await this.databaseService.instanceInvite.findUnique({
      where: { code: inviteCode },
      include: {
        defaultCommunities: true,
        usages: true,
      },
    });
    if (!invite) return null;
    const now = new Date();

    // Validation conditions
    if (
      invite.disabled ||
      (invite.validUntil && now > invite.validUntil) ||
      (invite.maxUses !== null && invite.uses >= invite.maxUses)
    ) {
      return null;
    }
    return invite;
  }

  async redeemInviteWithTx(
    tx: Prisma.TransactionClient,
    inviteCode: string,
    userId: string,
  ): Promise<InstanceInviteWithRelations | null> {
    // Use a transaction for safety
    const invite = await tx.instanceInvite.findUnique({
      where: { code: inviteCode },
      include: {
        defaultCommunities: true,
      },
    });

    if (!invite) {
      this.logger.warn(`Invalid invite code: ${inviteCode}`);
      return null;
    }

    const now = new Date();
    if (
      invite.disabled ||
      (invite.validUntil && now > invite.validUntil) ||
      (invite.maxUses !== null && invite.uses >= invite.maxUses)
    ) {
      this.logger.warn(`Invalid or already used invite: ${invite.code}`);
      return null;
    }

    // Check if user has already used this invite via the junction table
    const existingUsage = await tx.instanceInviteUsage.findUnique({
      where: {
        inviteId_userId: {
          inviteId: invite.id,
          userId,
        },
      },
    });

    if (existingUsage) {
      this.logger.warn(`Invalid or already used invite: ${invite.code}`);
      return null;
    }

    // Record the usage in the junction table
    await tx.instanceInviteUsage.create({
      data: {
        inviteId: invite.id,
        userId,
      },
    });

    // Update uses count and disabled status
    const updated = await tx.instanceInvite.update({
      where: { code: inviteCode },
      data: {
        uses: { increment: 1 },
        disabled: invite.maxUses !== null && invite.uses + 1 >= invite.maxUses,
      },
      include: {
        defaultCommunities: true,
        usages: true,
      },
    });

    return updated;
  }

  async getInvites(user: UserEntity): Promise<InstanceInviteWithRelations[]> {
    return this.databaseService.instanceInvite.findMany({
      where: { createdById: user.id },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        defaultCommunities: true,
        usages: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInviteByCode(
    code: string,
  ): Promise<InstanceInviteWithRelations | null> {
    return this.databaseService.instanceInvite.findUnique({
      where: { code },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        defaultCommunities: true,
        usages: true,
      },
    });
  }

  async deleteInvite(user: UserEntity, code: string): Promise<void> {
    const invite = await this.databaseService.instanceInvite.findUnique({
      where: { code },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    // Only allow the creator to delete the invite (admins bypass via RBAC)
    if (invite.createdById !== user.id) {
      throw new ForbiddenException('Unauthorized to delete this invite');
    }

    await this.databaseService.instanceInvite.delete({
      where: { code },
    });
  }

  private generateInviteCode(digits: number = INVITE_CODE_DIGITS) {
    return randomInt(0, 10 ** digits)
      .toString()
      .padStart(digits, '0');
  }
}
