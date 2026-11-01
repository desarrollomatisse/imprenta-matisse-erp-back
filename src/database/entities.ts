import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

// Usuarios, sesiones, responsables, órdenes, tareas, eventos y adjuntos.
// Roles, áreas, estados y permisos viven en código, no en la base.

@Entity('users')
@Index('users_role_key_idx', ['roleKey'])
export class UserEntity {
  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'users_pkey' })
  email: string;

  @Column({ name: 'role_key', type: 'text' })
  roleKey: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({ name: 'must_change_password', type: 'boolean', default: true })
  mustChangePassword: boolean;

  // Solo guarda las diferencias con el rol: true agrega, false quita.
  @Column({ name: 'permission_overrides', type: 'jsonb', default: {} })
  permissionOverrides: Record<string, boolean>;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'text', nullable: true })
  deletedBy: string | null;
}

@Entity('rate_limits')
@Index('rate_limits_reset_at_idx', ['resetAt'])
export class RateLimitEntity {
  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'rate_limits_pkey' })
  key: string;

  @Column({ type: 'integer' })
  hits: number;

  @Column({ name: 'reset_at', type: 'timestamptz' })
  resetAt: Date;
}

// Una fila por dispositivo. Solo se guardan hashes del refresh token.
@Entity('auth_sessions')
@Index('auth_sessions_user_email_idx', ['userEmail'])
@Index('auth_sessions_expires_at_idx', ['expiresAt'])
export class AuthSessionEntity {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'auth_sessions_pkey',
  })
  id: string;

  @Column({ name: 'user_email', type: 'text' })
  userEmail: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'user_email',
    foreignKeyConstraintName: 'auth_sessions_user_email_fkey',
  })
  user?: UserEntity;

  @Column({ name: 'token_hash', type: 'text' })
  tokenHash: string;

  @Column({ name: 'previous_token_hash', type: 'text', nullable: true })
  previousTokenHash: string | null;

  @Column({ type: 'boolean' })
  remember: boolean;

  @Column({ name: 'rotated_at', type: 'timestamptz' })
  rotatedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ name: 'end_reason', type: 'text', nullable: true })
  endReason: string | null;
}

// Los índices únicos parciales con lower() se declaran solo en la migración.
@Entity('responsibles')
@Index('responsibles_area_name_active_ci_idx', { synchronize: false })
@Index('responsibles_area_email_active_ci_idx', { synchronize: false })
export class ResponsibleEntity {
  @PrimaryGeneratedColumn('increment', {
    type: 'bigint',
    primaryKeyConstraintName: 'responsibles_pkey',
  })
  id: string;

  @Column({ type: 'text' })
  area: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('orders')
@Unique('orders_number_key', ['number'])
@Index('orders_status_idx', ['summaryStatus'])
@Index('orders_current_area_idx', ['currentArea'])
@Index('orders_due_date_idx', ['dueDate'])
@Index('orders_created_at_idx', ['createdAt'])
@Index('orders_updated_at_idx', ['updatedAt'])
@Index('orders_idempotency_key_idx', { synchronize: false })
export class OrderEntity {
  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'orders_pkey' })
  id: string;

  @Column({ type: 'text' })
  number: string;

  @Column({ name: 'customer_name', type: 'text' })
  customerName: string;

  @Column({ name: 'customer_phone', type: 'text', nullable: true })
  customerPhone: string | null;

  @Column({ name: 'customer_address', type: 'text', nullable: true })
  customerAddress: string | null;

  @Column({ name: 'product_family', type: 'text' })
  productFamily: string;

  @Column({ name: 'product_name', type: 'text' })
  productName: string;

  @Column({ type: 'text', default: '' })
  specifications: string;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ name: 'has_plate', type: 'boolean', default: false })
  hasPlate: boolean;

  @Column({ name: 'summary_status', type: 'text' })
  summaryStatus: string;

  @Column({ name: 'current_area', type: 'text', nullable: true })
  currentArea: string | null;

  // Sube con cada cambio de la orden: quien actúa con una copia vieja pierde.
  @Column({ type: 'integer', default: 1 })
  version: number;

  // Dónde estaba al cancelarse, para reactivarla en el mismo punto.
  @Column({ name: 'cancelled_from_status', type: 'text', nullable: true })
  cancelledFromStatus: string | null;

  @Column({ name: 'cancelled_from_area', type: 'text', nullable: true })
  cancelledFromArea: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true })
  idempotencyKey: string | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'text', nullable: true })
  deletedBy: string | null;

  // Se llenan al hidratar la orden; no son relaciones gestionadas por save().
  tasks: OrderTaskEntity[];
  events: OrderEventEntity[];
}

@Entity('order_tasks')
@Index('order_tasks_order_created_idx', ['orderId', 'createdAt'])
@Index('order_tasks_status_idx', ['status'])
@Index('order_tasks_area_idx', ['area'])
@Index('order_tasks_responsible_idx', ['responsibleId'])
export class OrderTaskEntity {
  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'order_tasks_pkey' })
  id: string;

  @Column({ name: 'order_id', type: 'text' })
  orderId: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'order_tasks_order_id_fkey',
  })
  order?: OrderEntity;

  @Column({ type: 'text' })
  area: string;

  @Column({ type: 'text' })
  status: string;

  @Column({ name: 'cancelled_from_status', type: 'text', nullable: true })
  cancelledFromStatus: string | null;

  @Column({ name: 'responsible_id', type: 'bigint', nullable: true })
  responsibleId: string | null;

  @ManyToOne(() => ResponsibleEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'responsible_id',
    foreignKeyConstraintName: 'order_tasks_responsible_id_fkey',
  })
  responsible?: ResponsibleEntity | null;

  @Column({ name: 'planned_quantity', type: 'integer' })
  plannedQuantity: number;

  @Column({ name: 'completed_quantity', type: 'integer', default: 0 })
  completedQuantity: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('order_events')
@Index('order_events_order_created_idx', ['orderId', 'createdAt'])
export class OrderEventEntity {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'order_events_pkey',
  })
  id: string;

  @Column({ name: 'order_id', type: 'text' })
  orderId: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'order_events_order_id_fkey',
  })
  order?: OrderEntity;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'text', nullable: true })
  status: string | null;

  @Column({ name: 'target_area', type: 'text', nullable: true })
  targetArea: string | null;

  @Column({ name: 'from_role', type: 'text', nullable: true })
  fromRole: string | null;

  @Column({ name: 'target_role', type: 'text', nullable: true })
  targetRole: string | null;

  @Column({ name: 'assignment_assignee', type: 'text', nullable: true })
  assignmentAssignee: string | null;

  @Column({ name: 'assignment_area', type: 'text', nullable: true })
  assignmentArea: string | null;

  @Column({ type: 'text' })
  actor: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  attachments: OrderAttachmentEntity[];
}

@Entity('order_attachments')
@Index('order_attachments_order_idx', ['orderId'])
@Index('order_attachments_event_idx', ['eventId'])
export class OrderAttachmentEntity {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'order_attachments_pkey',
  })
  id: string;

  @Column({ name: 'order_id', type: 'text' })
  orderId: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'order_attachments_order_id_fkey',
  })
  order?: OrderEntity;

  @Column({ name: 'event_id', type: 'text', nullable: true })
  eventId: string | null;

  @ManyToOne(() => OrderEventEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'event_id',
    foreignKeyConstraintName: 'order_attachments_event_id_fkey',
  })
  event?: OrderEventEntity | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'mime_type', type: 'text' })
  mimeType: string;

  @Column({ name: 'web_view_link', type: 'text' })
  webViewLink: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'text', nullable: true })
  deletedBy: string | null;
}

@Entity('catalog_families')
@Index('catalog_families_label_idx', { synchronize: false })
export class CatalogFamilyEntity {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'catalog_families_pkey',
  })
  id: string;

  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'text', nullable: true })
  deletedBy: string | null;
}

@Entity('catalog_products')
@Index('catalog_products_label_idx', { synchronize: false })
export class CatalogProductEntity {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'catalog_products_pkey',
  })
  id: string;

  @Column({ name: 'family_id', type: 'text' })
  familyId: string;

  @ManyToOne(() => CatalogFamilyEntity, { nullable: false })
  @JoinColumn({
    name: 'family_id',
    foreignKeyConstraintName: 'catalog_products_family_id_fkey',
  })
  family?: CatalogFamilyEntity;

  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'text', nullable: true })
  deletedBy: string | null;
}

@Entity('catalog_questions')
@Index('catalog_questions_label_idx', { synchronize: false })
export class CatalogQuestionEntity {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'catalog_questions_pkey',
  })
  id: string;

  @Column({ name: 'product_id', type: 'text' })
  productId: string;

  @ManyToOne(() => CatalogProductEntity, { nullable: false })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'catalog_questions_product_id_fkey',
  })
  product?: CatalogProductEntity;

  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'text', nullable: true })
  deletedBy: string | null;
}

@Entity('catalog_options')
@Index('catalog_options_label_idx', { synchronize: false })
export class CatalogOptionEntity {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'catalog_options_pkey',
  })
  id: string;

  @Column({ name: 'question_id', type: 'text' })
  questionId: string;

  @ManyToOne(() => CatalogQuestionEntity, { nullable: false })
  @JoinColumn({
    name: 'question_id',
    foreignKeyConstraintName: 'catalog_options_question_id_fkey',
  })
  question?: CatalogQuestionEntity;

  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'text' })
  phrase: string;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'text', nullable: true })
  deletedBy: string | null;
}

// La escriben los triggers y el registro de peticiones; nadie puede cambiarla.
@Entity('audit_log')
@Index('audit_log_at_idx', ['at'])
@Index('audit_log_actor_idx', ['actor', 'id'])
@Index('audit_log_entity_idx', ['entity', 'entityId', 'id'])
@Index('audit_log_order_idx', ['orderId', 'id'])
@Index('audit_log_request_idx', ['requestId'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'audit_log_pkey',
  })
  id: string;

  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  at: Date;

  @Column({ type: 'text' })
  kind: string;

  @Column({ type: 'text', nullable: true })
  actor: string | null;

  @Column({ name: 'actor_role', type: 'text', nullable: true })
  actorRole: string | null;

  @Column({ type: 'text', nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId: string | null;

  @Column({ type: 'text' })
  action: string;

  @Column({ type: 'text' })
  entity: string;

  @Column({ name: 'entity_id', type: 'text', nullable: true })
  entityId: string | null;

  @Column({ name: 'order_id', type: 'text', nullable: true })
  orderId: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  changed: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  before: object | null;

  @Column({ type: 'jsonb', nullable: true })
  after: object | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: object | null;

  @Column({ type: 'integer', nullable: true })
  status: number | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs: number | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;
}

export const ENTITIES = [
  UserEntity,
  RateLimitEntity,
  AuthSessionEntity,
  ResponsibleEntity,
  OrderEntity,
  OrderTaskEntity,
  OrderEventEntity,
  OrderAttachmentEntity,
  CatalogFamilyEntity,
  CatalogProductEntity,
  CatalogQuestionEntity,
  CatalogOptionEntity,
  AuditLogEntity,
];
