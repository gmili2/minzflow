import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères'),
  FRONTEND_URL: z.string().min(1).transform((s) => s.split(',').map((u) => u.trim()).filter(Boolean)),
  UPLOAD_DIR: z.string().default('uploads'),
  // Compte super-administrateur créé (ou mis à jour) par `node dist/cli/bootstrap.js`.
  SUPERADMIN_EMAIL: z.string().email().optional(),
  SUPERADMIN_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof schema>;

/** Valide les variables d'environnement au démarrage : l'application refuse de démarrer si une valeur manque. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${lines}`);
  }
  return parsed.data;
}
