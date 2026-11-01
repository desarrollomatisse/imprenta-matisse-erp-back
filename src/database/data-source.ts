import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AuditContextSubscriber } from '../audit/audit-context.subscriber';
import { env } from '../config/env';
import { ENTITIES } from './entities';
import { InitialSchema1761609600000 } from './migrations/1761609600000-InitialSchema';
import { AddUserPasswordHash1761696000000 } from './migrations/1761696000000-AddUserPasswordHash';
import { CreateAuthSessions1761782400000 } from './migrations/1761782400000-CreateAuthSessions';
import { AddSecurityControls1761868800000 } from './migrations/1761868800000-AddSecurityControls';
import { AddSoftDeleteAndCatalog1761955200000 } from './migrations/1761955200000-AddSoftDeleteAndCatalog';
import { AddPermissionOverrides1762041600000 } from './migrations/1762041600000-AddPermissionOverrides';
import { AddAuditLogAndOrderVersion1762128000000 } from './migrations/1762128000000-AddAuditLogAndOrderVersion';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: env.DATABASE_URL,
  entities: ENTITIES,
  subscribers: [AuditContextSubscriber],
  migrations: [
    InitialSchema1761609600000,
    AddUserPasswordHash1761696000000,
    CreateAuthSessions1761782400000,
    AddSecurityControls1761868800000,
    AddSoftDeleteAndCatalog1761955200000,
    AddPermissionOverrides1762041600000,
    AddAuditLogAndOrderVersion1762128000000,
  ],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  // Una espera sin límite ocuparía el pool y dejaría a toda la API sin conexión.
  extra: {
    connectionTimeoutMillis: 10_000,
    lock_timeout: 5_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
  },
};

export default new DataSource(dataSourceOptions);
