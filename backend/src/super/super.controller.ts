import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { AuthService } from '../auth/auth.service';
import { SuperOnly } from '../common/decorators';
import { bad, conflict, notFound } from '../common/http';
import { hashPassword } from '../common/password';
import { SuperTenantDto, TENANT_PUBLIC } from '../common/tenant-info.dto';
import { MAX_UPLOAD_BYTES, UploadsService } from '../common/uploads.service';
import { PrismaService } from '../prisma.service';

const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

class AdminDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @lower() @IsEmail({}, { message: 'Email de connexion invalide' }) @MaxLength(254) email: string;
  @IsString() @MinLength(8, { message: 'Mot de passe : 8 caractères minimum' }) @MaxLength(200) password: string;
}

class CreateTenantDto extends SuperTenantDto {
  @ValidateNested() @Type(() => AdminDto) admin: AdminDto;
}

class UserPatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @lower() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MinLength(8, { message: 'Mot de passe : 8 caractères minimum' }) @MaxLength(200) password?: string;
  @IsOptional() @IsIn(['ADMIN', 'COMPTABLE', 'COMMERCIAL', 'LECTURE']) role?: 'ADMIN' | 'COMPTABLE' | 'COMMERCIAL' | 'LECTURE';
}

class DeleteDto { @IsString() confirm: string; }

function slugify(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'entreprise';
}

/** Espace super-administrateur : création et gestion des entreprises clientes de la plateforme. */
@SuperOnly()
@Controller('super')
export class SuperController {
  constructor(private prisma: PrismaService, private uploads: UploadsService, private auth: AuthService) {}

  @Get('tenants')
  async list() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' }, select: { ...TENANT_PUBLIC, _count: { select: { users: true, clients: true, documents: true } } } });
    const ca = await this.prisma.document.groupBy({ by: ['tenantId'], where: { type: 'FACTURE', status: { not: 'ANNULEE' } }, _sum: { totalTTC: true } });
    const last = await this.prisma.user.groupBy({ by: ['tenantId'], _max: { lastLoginAt: true } });
    const caMap = new Map(ca.map((c) => [c.tenantId, c._sum.totalTTC ?? 0]));
    const lastMap = new Map(last.map((l) => [l.tenantId, l._max.lastLoginAt]));
    return {
      data: tenants.map(({ _count, ...t }) => ({
        ...t, users: _count.users, clients: _count.clients, documents: _count.documents, ca: caMap.get(t.id) ?? 0, lastLogin: lastMap.get(t.id) ?? null,
      })),
    };
  }

  @Get('tenants/:id')
  async get(@Param('id') id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: TENANT_PUBLIC });
    if (!t) throw notFound('Entreprise introuvable');
    const users = await this.prisma.user.findMany({
      where: { tenantId: id }, orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true },
    });
    return { data: { ...t, users } };
  }

  @Post('tenants')
  async create(@Body() dto: CreateTenantDto) {
    const { admin, ...info } = dto;
    if (!info.name) throw bad('Le nom de l\'entreprise est obligatoire');
    if (await this.prisma.user.findUnique({ where: { email: admin.email } })) throw conflict('Cet email de connexion est déjà utilisé');
    const base = slugify(info.name);
    let slug = base;
    for (let i = 2; await this.prisma.tenant.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    const passwordHash = await hashPassword(admin.password);
    const tenant = await this.prisma.tenant.create({
      data: {
        ...info, name: info.name, slug,
        users: { create: { email: admin.email, name: admin.name, role: 'ADMIN', passwordHash } },
        activities: { create: { kind: 'client', title: 'Espace entreprise créé', sub: `Administrateur : ${admin.name}` } },
      },
      select: TENANT_PUBLIC,
    });
    return { data: tenant };
  }

  @Patch('tenants/:id')
  async update(@Param('id') id: string, @Body() dto: SuperTenantDto) {
    await this.ensure(id);
    if (dto.name === '') throw bad('Le nom de l\'entreprise est obligatoire');
    return { data: await this.prisma.tenant.update({ where: { id }, data: dto, select: TENANT_PUBLIC }) };
  }

  @Post('tenants/:id/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async logo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const t = await this.ensure(id);
    const logoUrl = await this.uploads.saveImage(file, 'logos');
    await this.prisma.tenant.update({ where: { id }, data: { logoUrl } });
    await this.uploads.removeByUrl(t.logoUrl);
    return { data: { logoUrl } };
  }

  @Delete('tenants/:id/logo') @HttpCode(204)
  async removeLogo(@Param('id') id: string) {
    const t = await this.ensure(id);
    await this.prisma.tenant.update({ where: { id }, data: { logoUrl: null } });
    await this.uploads.removeByUrl(t.logoUrl);
  }

  /** Ajoute un utilisateur à l'entreprise (souvent un second administrateur). */
  @Post('tenants/:id/users')
  async addUser(@Param('id') id: string, @Body() dto: AdminDto) {
    await this.ensure(id);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw conflict('Cet email de connexion est déjà utilisé');
    const u = await this.prisma.user.create({
      data: { tenantId: id, email: dto.email, name: dto.name, role: 'ADMIN', passwordHash: await hashPassword(dto.password) },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    return { data: u };
  }

  /** Modifie un utilisateur d'entreprise (email de connexion, nom, rôle, nouveau mot de passe). */
  @Patch('users/:userId')
  async patchUser(@Param('userId') userId: string, @Body() dto: UserPatchDto) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || u.role === 'SUPERADMIN') throw notFound('Utilisateur introuvable');
    if (dto.email && dto.email !== u.email && (await this.prisma.user.findUnique({ where: { email: dto.email } }))) throw conflict('Cet email de connexion est déjà utilisé');
    const { password, ...rest } = dto;
    const updated = await this.prisma.user.update({
      where: { id: userId }, data: { ...rest, ...(password && { passwordHash: await hashPassword(password) }) },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    if (password) await this.auth.revokeAll(userId);
    return { data: updated };
  }

  /** Supprime définitivement une entreprise et toutes ses données (confirmation : identifiant de l'entreprise). */
  @Delete('tenants/:id') @HttpCode(204)
  async remove(@Param('id') id: string, @Body() dto: DeleteDto) {
    const t = await this.ensure(id);
    if (dto.confirm !== t.slug) throw bad(`Pour confirmer, saisissez l'identifiant « ${t.slug} »`);
    await this.prisma.tenant.delete({ where: { id } });
    await this.uploads.removeByUrl(t.logoUrl);
  }

  private async ensure(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Entreprise introuvable');
    return t;
  }
}
