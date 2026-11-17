import { Global, Injectable, Module } from '@nestjs/common';
import type { Ctx } from '../common/decorators';
import { PrismaService } from '../prisma.service';

export type ActivityKind = 'facture' | 'paiement' | 'client' | 'devis' | 'depense' | 'stock' | 'achat' | 'user' | 'settings';

/** Fil d'activité de l'entreprise (tableau de bord). */
@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  async log(ctx: Ctx, kind: ActivityKind, title: string, sub?: string) {
    await this.prisma.activity.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, kind, title: title.slice(0, 200), sub: sub?.slice(0, 200) } }).catch(() => undefined);
  }
}

@Global()
@Module({ providers: [ActivityService], exports: [ActivityService] })
export class ActivityModule {}
