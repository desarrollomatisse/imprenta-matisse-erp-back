import { AsyncLocalStorage } from 'node:async_hooks';

/** Quién hace la petición en curso; acompaña a todo lo que ella escribe. */
export type AuditContext = {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  actor: string | null;
  actorRole: string | null;
  orderId: string | null;
  logRead: boolean;
  error: string | null;
};

const storage = new AsyncLocalStorage<AuditContext>();

export const auditContext = () => storage.getStore();

export const runInAuditContext = <T>(context: AuditContext, work: () => T): T =>
  storage.run(context, work);

export function identifyAuditActor(user: {
  email: string;
  roleKey?: string;
}): void {
  const context = auditContext();
  if (!context) return;
  context.actor = user.email;
  context.actorRole = user.roleKey ?? context.actorRole;
}
