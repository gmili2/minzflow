import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService, publicUser } from '../auth/auth.service';
import { type Ctx, Perm, TenantCtx, TenantUser } from '../common/decorators';
import { bad, conflict, notFound } from '../common/http';
import { hashPassword } from '../common/password';
import { SuperTenantDto, TENANT_PUBLIC, TenantInfoDto } from '../common/tenant-info.dto';
import { MAX_UPLOAD_BYTES, UploadsService } from '../common/uploads.service';
import { PrismaService } from '../prisma.service';
import { ActivityService } from './activity.service';

const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const ROLES = ['ADMIN', 'COMPTABLE', 'COMMERCIAL', 'LECTURE'] as const;
type TRole = (typeof ROLES)[number];

class CreateUserDto {
  @trim() @IsString() @MinLength(2, { message: 'Nom obligatoire' }) @MaxLength(120) name: string;
  @lower() @IsEmail({}, { message: 'Email invalide' }) @MaxLength(254) email: string;
  @IsIn(ROLES) role: TRole;
  @IsString() @MinLength(8, { message: 'Mot de passe : 8 caractères minimum' }) @MaxLength(200) password: string;
}

class PatchUserDto {
  @IsOptional() @trim() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @lower() @IsEmail({}, { message: 'Email invalide' }) @MaxLength(254) email?: string;
  @IsOptional() @IsIn(ROLES) role?: TRole;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8, { message: 'Mot de passe : 8 caractères minimum' }) @MaxLength(200) password?: string;
}

class ProfileDto { @trim() @IsString() @MinLength(2) @MaxLength(120) name: string; }

const USER_OUT = { id: true, name: true, email: true, role: true, active: true, avatarUrl: true, lastLoginAt: true, createdAt: true } as const;

@Controller()
export class TeamController {
  constructor(private prisma: PrismaService, private uploads: UploadsService, private auth: AuthService, private activity: ActivityService) {}

  @Perm('utilisateurs') @Get('users')
  async list(@TenantCtx() ctx: Ctx) {
    return { data: await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: USER_OUT, orderBy: { createdAt: 'asc' } }) };
  }

  @Perm('utilisateurs', 'write') @Post('users')
  async create(@TenantCtx() ctx: Ctx, @Body() dto: CreateUserDto) {
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw conflict('Cet email est déjà utilisé');
    const u = await this.prisma.user.create({
      data: { tenantId: ctx.tenantId, name: dto.name, email: dto.email, role: dto.role, passwordHash: await hashPassword(dto.password) }, select: USER_OUT,
    });
    await this.activity.log(ctx, 'user', 'Nouvel utilisateur', `${u.name} (${u.email})`);
    return { data: u };
  }

  @Perm('utilisateurs', 'write') @Patch('users/:id')
  async update(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: PatchUserDto) {
    const u = await this.prisma.user.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!u) throw notFound('Utilisateur introuvable');
    const losesAdmin = u.role === 'ADMIN' && ((dto.role && dto.role !== 'ADMIN') || dto.active === false);
    if (losesAdmin && (await this.prisma.user.count({ where: { tenantId: ctx.tenantId, role: 'ADMIN', active: true } })) <= 1) throw bad('Il faut garder au moins un administrateur actif');
    if (dto.email && dto.email !== u.email && (await this.prisma.user.findUnique({ where: { email: dto.email } }))) throw conflict('Cet email est déjà utilisé');
    const { password, ...rest } = dto;
    const updated = await this.prisma.user.update({ where: { id }, data: { ...rest, ...(password && { passwordHash: await hashPassword(password) }) }, select: USER_OUT });
    if (password || dto.active === false) await this.auth.revokeAll(id);
    await this.activity.log(ctx, 'user', 'Utilisateur modifié', updated.name);
    return { data: updated };
  }

  @Perm('utilisateurs', 'write') @Delete('users/:id') @HttpCode(204)
  async remove(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    if (id === ctx.userId) throw bad('Vous ne pouvez pas supprimer votre propre compte');
    const u = await this.prisma.user.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!u) throw notFound('Utilisateur introuvable');
    if (u.role === 'ADMIN' && (await this.prisma.user.count({ where: { tenantId: ctx.tenantId, role: 'ADMIN', active: true } })) <= 1) throw bad('Il faut garder au moins un administrateur actif');
    await this.prisma.user.delete({ where: { id } });
    await this.uploads.removeByUrl(u.avatarUrl);
  }

  /* ───────────── Profil personnel (tout utilisateur) ───────────── */

  @TenantUser() @Patch('profile')
  async profile(@TenantCtx() ctx: Ctx, @Body() dto: ProfileDto) {
    await this.prisma.user.update({ where: { id: ctx.userId }, data: { name: dto.name } });
    return { data: await this.auth.me(ctx.userId) };
  }

  @TenantUser() @Post('profile/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async avatar(@TenantCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    const avatarUrl = await this.uploads.saveImage(file, 'avatars');
    await this.prisma.user.update({ where: { id: u.id }, data: { avatarUrl } });
    await this.uploads.removeByUrl(u.avatarUrl);
    return { data: await this.auth.me(ctx.userId) };
  }

  @TenantUser() @Delete('profile/avatar')
  async removeAvatar(@TenantCtx() ctx: Ctx) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    await this.prisma.user.update({ where: { id: u.id }, data: { avatarUrl: null } });
    await this.uploads.removeByUrl(u.avatarUrl);
    return { data: await this.auth.me(ctx.userId) };
  }

  /* ───────────── Fiche société ───────────── */

  /** Lisible par tout utilisateur : en-têtes des documents imprimés. */
  @TenantUser() @Get('company')
  async company(@TenantCtx() ctx: Ctx) {
    return { data: await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: TENANT_PUBLIC }) };
  }

  @Perm('parametres', 'write') @Patch('company')
  async updateCompany(@TenantCtx() ctx: Ctx, @Body() dto: TenantInfoDto) {
    if (dto.name === '') throw bad('Le nom de la société est obligatoire');
    // « active » n'existe pas dans TenantInfoDto : seule la plateforme peut suspendre un espace.
    const data: Omit<SuperTenantDto, 'active'> = dto;
    const t = await this.prisma.tenant.update({ where: { id: ctx.tenantId }, data, select: TENANT_PUBLIC });
    await this.activity.log(ctx, 'settings', 'Paramètres de la société mis à jour');
    return { data: t };
  }

  @Perm('parametres', 'write') @Post('company/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async logo(@TenantCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const logoUrl = await this.uploads.saveImage(file, 'logos');
    await this.prisma.tenant.update({ where: { id: t.id }, data: { logoUrl } });
    await this.uploads.removeByUrl(t.logoUrl);
    return { data: { logoUrl } };
  }

  @TenantUser() @Get('me')
  async me(@TenantCtx() ctx: Ctx) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, include: { tenant: true } });
    return { data: publicUser(u) };
  }
}
