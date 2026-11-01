import {
  EntitySubscriberInterface,
  EventSubscriber,
  TransactionStartEvent,
} from 'typeorm';
import { auditContext } from './audit-context';

/**
 * Entrega a los triggers quién está escribiendo. `set_config` con `true` vive
 * solo en esta transacción, así que no se filtra a otra petición del pool.
 */
@EventSubscriber()
export class AuditContextSubscriber implements EntitySubscriberInterface {
  async afterTransactionStart(event: TransactionStartEvent): Promise<void> {
    const context = auditContext();
    if (!context) return;
    await event.queryRunner.query(
      `SELECT set_config('app.request_id', $1, true),
              set_config('app.actor', $2, true),
              set_config('app.actor_role', $3, true),
              set_config('app.ip', $4, true),
              set_config('app.user_agent', $5, true)`,
      [
        context.requestId,
        context.actor ?? '',
        context.actorRole ?? '',
        context.ip ?? '',
        context.userAgent ?? '',
      ],
    );
  }
}
