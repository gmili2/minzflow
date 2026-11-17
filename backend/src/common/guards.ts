import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { can, type Module } from './access';
import { ANY_TENANT_USER, type Ctx, IS_PUBLIC, PERM, SUPER } from './decorators';

/** Guard global : toute route exige un JWT d'accès valide, sauf @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Authentification requise');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; role: Role }>(token);
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException('Session expirée');
    }
  }
}

/**
 * Relit l'utilisateur et son entreprise en base à chaque requête : un compte désactivé, une entreprise suspendue
 * ou un rôle modifié prennent effet immédiatement. Pose req.ctx (entreprise et rôle de confiance).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const perm = this.reflector.getAllAndOverride<{ module: Module; mode: 'read' | 'write' }>(PERM, targets);
    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER, targets);
    const anyUser = this.reflector.getAllAndOverride<boolean>(ANY_TENANT_USER, targets);
    if (!perm && !superOnly && !anyUser) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string }; ctx?: Ctx }>();
    if (!req.user) throw new UnauthorizedException('Authentification requise');
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, role: true, active: true, name: true, tenantId: true, tenant: { select: { active: true } } },
    });
    if (!user || !user.active) throw new UnauthorizedException('Compte désactivé');

    if (superOnly) {
      if (user.role !== 'SUPERADMIN') throw new ForbiddenException('Réservé au super-administrateur');
      return true;
    }
    if (user.role === 'SUPERADMIN' || !user.tenantId || !user.tenant) throw new ForbiddenException('Aucune entreprise associée à ce compte');
    if (!user.tenant.active) throw new ForbiddenException('Espace entreprise suspendu. Contactez le support MizanFlow.');
    if (perm && !can(user.role, perm.module, perm.mode)) {
      throw new ForbiddenException(perm.mode === 'write' ? 'Action non autorisée pour votre rôle' : 'Module non accessible avec votre rôle');
    }
    req.ctx = { userId: user.id, tenantId: user.tenantId, role: user.role, name: user.name };
    return true;
  }
}
