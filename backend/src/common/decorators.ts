import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { Module } from './access';

export const IS_PUBLIC = 'isPublic';
export const PERM = 'perm';
export const SUPER = 'superOnly';
export const ANY_TENANT_USER = 'anyTenantUser';

/** Ouvre une route sans authentification (le guard JWT est global). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route d'entreprise : exige le droit de lecture ou d'écriture sur le module. */
export const Perm = (module: Module, mode: 'read' | 'write' = 'read') => SetMetadata(PERM, { module, mode });
/** Route réservée au super-administrateur de la plateforme. */
export const SuperOnly = () => SetMetadata(SUPER, true);
/** Route d'entreprise accessible à tout utilisateur actif (profil, notifications…). */
export const TenantUser = () => SetMetadata(ANY_TENANT_USER, true);

export type Ctx = { userId: string; tenantId: string; role: Role; name: string };
export type AuthUser = { id: string; email: string; role: Role };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
/** Contexte d'entreprise vérifié par AccessGuard (tenantId toujours issu de la base, jamais du client). */
export const TenantCtx = createParamDecorator((_: unknown, ctx: ExecutionContext): Ctx => ctx.switchToHttp().getRequest().ctx);
