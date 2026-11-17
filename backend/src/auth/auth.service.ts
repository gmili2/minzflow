import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { READ, ROLE_LABEL, WRITE, type TenantRole } from '../common/access';
import { AppError } from '../common/http';
import { hashPassword, verifyPassword } from '../common/password';
import { PrismaService } from '../prisma.service';

export const REFRESH_TTL_DAYS = 14;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
type Meta = { userAgent?: string; ip?: string };

const USER_SELECT = {
  id: true, email: true, name: true, role: true, avatarUrl: true, active: true, passwordHash: true,
  tenant: { select: { id: true, name: true, logoUrl: true, primaryColor: true, active: true } },
} as const;

type LoadedUser = {
  id: string; email: string; name: string; role: Role; avatarUrl: string | null; active: boolean;
  tenant: { id: string; name: string; logoUrl: string | null; primaryColor: string; active: boolean } | null;
};

/** Profil renvoyé au front : identité, entreprise (logo, couleur) et droits par module. */
export function publicUser(u: LoadedUser) {
  const r = u.role === 'SUPERADMIN' ? null : (u.role as TenantRole);
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role], avatarUrl: u.avatarUrl,
    tenant: u.tenant ? { id: u.tenant.id, name: u.tenant.name, logoUrl: u.tenant.logoUrl, primaryColor: u.tenant.primaryColor } : null,
    read: r ? READ[r] : [], write: r ? WRITE[r] : [],
  };
}

@Injectable()
export class AuthService {
  /** Hash factice, vérifié quand l'email est inconnu pour garder un temps de réponse constant. */
  private dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string, meta: Meta) {
    const user = await this.prisma.user.findUnique({ where: { email }, select: USER_SELECT });
    const ok = await verifyPassword(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user || !ok) throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');
    this.assertUsable(user);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const refreshToken = await this.createSession(user.id, randomUUID(), meta);
    return { user: publicUser(user), accessToken: await this.sign(user), refreshToken };
  }

  private assertUsable(user: LoadedUser) {
    if (!user.active) throw new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_DISABLED', 'Compte désactivé. Contactez votre administrateur.');
    if (user.role !== 'SUPERADMIN' && (!user.tenant || !user.tenant.active)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'TENANT_SUSPENDED', 'Espace entreprise suspendu. Contactez le support MizanFlow.');
    }
  }

  /** Rotation : l'ancien refresh token est révoqué ; s'il est rejoué, toute la famille de sessions est révoquée. */
  async refresh(token: string | undefined, meta: Meta) {
    const invalid = new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_REFRESH_TOKEN', 'Session expirée, reconnectez-vous');
    if (!token) throw invalid;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: USER_SELECT } } });
    if (!session) throw invalid;
    if (session.revokedAt) {
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw invalid;
    }
    const { user } = session;
    if (session.expiresAt < new Date()) throw invalid;
    try { this.assertUsable(user); } catch { throw invalid; }

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!count) throw invalid;
      const next = await tx.session.create({ data: this.sessionData(user.id, session.familyId, raw, meta) });
      await tx.session.update({ where: { id: session.id }, data: { replacedById: next.id } });
    });
    return { user: publicUser(user), accessToken: await this.sign(user), refreshToken: raw };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Session expirée');
    this.assertUsable(user);
    return publicUser(user);
  }

  async changePassword(id: string, current: string, next: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !(await verifyPassword(user.passwordHash, current))) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_PASSWORD', 'Mot de passe actuel incorrect');
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(next) } });
  }

  /** Révoque toutes les sessions d'un utilisateur (désactivation, changement de mot de passe par un admin). */
  async revokeAll(userId: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private sign(u: { id: string; email: string; role: string }) {
    return this.jwt.signAsync({ sub: u.id, email: u.email, role: u.role });
  }

  private async createSession(userId: string, familyId: string, meta: Meta) {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.session.create({ data: this.sessionData(userId, familyId, raw, meta) });
    return raw;
  }

  private sessionData(userId: string, familyId: string, raw: string, meta: Meta) {
    return {
      userId, familyId, tokenHash: sha256(raw), userAgent: meta.userAgent?.slice(0, 255), ip: meta.ip?.slice(0, 45),
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
    };
  }
}
