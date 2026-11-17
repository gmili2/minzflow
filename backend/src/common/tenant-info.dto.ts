import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const emptyToNull = () => Transform(({ value }) => (typeof value === 'string' ? (value.trim() || null) : value));

/** Fiche société : modifiable par le super-admin et par l'administrateur de l'entreprise (Paramètres). */
export class TenantInfoDto {
  @IsOptional() @trim() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Couleur au format #RRGGBB' }) primaryColor?: string;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(40) legalForm?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(30) ice?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(30) rc?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(30) ifiscal?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(30) patente?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(30) cnss?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(40) capital?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(255) address?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(80) city?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @emptyToNull() @ValidateIf((_, v) => v != null) @IsEmail({}, { message: 'Email de la société invalide' }) @MaxLength(254) email?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(160) website?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(80) bankName?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(40) rib?: string | null;
  @IsOptional() @IsIn([0, 7, 10, 14, 20], { message: 'Taux de TVA : 0, 7, 10, 14 ou 20 %' }) tvaDefault?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) quoteDays?: number;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(2000) footer?: string | null;
  @IsOptional() @IsInt() openingCash?: number;
}

export class SuperTenantDto extends TenantInfoDto {
  @IsOptional() @IsBoolean() active?: boolean;
}

export const TENANT_PUBLIC = {
  id: true, name: true, slug: true, logoUrl: true, primaryColor: true, legalForm: true, ice: true, rc: true, ifiscal: true, patente: true,
  cnss: true, capital: true, address: true, city: true, phone: true, email: true, website: true, bankName: true, rib: true,
  tvaDefault: true, paymentDays: true, quoteDays: true, footer: true, openingCash: true, active: true, createdAt: true,
} as const;
