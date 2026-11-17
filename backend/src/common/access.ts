import type { Role } from '@prisma/client';

/** Modules de l'ERP (une page de l'application chacun). */
export const MODULES = [
  'dashboard', 'devis', 'bons', 'factures', 'achats', 'stocks', 'clients', 'fournisseurs',
  'caisse', 'depenses', 'rapports', 'utilisateurs', 'assistant', 'parametres',
] as const;
export type Module = (typeof MODULES)[number];
export type TenantRole = Exclude<Role, 'SUPERADMIN'>;

const ALL = [...MODULES];
const notUsers = ALL.filter((m) => m !== 'utilisateurs');

/** Pages visibles par rôle (même règle que la maquette). */
export const READ: Record<TenantRole, Module[]> = {
  ADMIN: ALL,
  COMPTABLE: notUsers,
  COMMERCIAL: ['dashboard', 'devis', 'bons', 'factures', 'stocks', 'clients', 'assistant', 'parametres'],
  LECTURE: notUsers,
};

/** Modules modifiables par rôle. « parametres » = fiche société (le profil personnel reste modifiable par chacun). */
export const WRITE: Record<TenantRole, Module[]> = {
  ADMIN: ALL,
  COMPTABLE: notUsers.filter((m) => m !== 'parametres'),
  COMMERCIAL: ['devis', 'bons', 'factures', 'clients'],
  LECTURE: [],
};

export const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: 'Super-administrateur', ADMIN: 'Administrateur', COMPTABLE: 'Comptable', COMMERCIAL: 'Commercial', LECTURE: 'Lecture seule',
};

export const can = (role: Role, module: Module, mode: 'read' | 'write') =>
  role !== 'SUPERADMIN' && (mode === 'read' ? READ : WRITE)[role].includes(module);
