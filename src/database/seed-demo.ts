import { EntityManager } from 'typeorm';
import { Area, OrderStatus, RoleKey, TaskStatus } from '../domain/enums';
import { areaName, orderStatusArea } from '../domain/workflow';
import dataSource from './data-source';
import { assertTestSeedAllowed } from './seed-guard';
import {
  OrderEntity,
  OrderEventEntity,
  OrderTaskEntity,
  ResponsibleEntity,
} from './entities';

const ACCOUNT_DOMAIN = 'matisse.test';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const RESPONSIBLES: Record<string, string[]> = {
  [Area.ATTENTION]: ['Rosa Quispe', 'Mario Salazar'],
  [Area.DESIGN]: ['Lucía Paredes', 'Diego Huamán'],
  [Area.PRODUCTION]: ['Jorge Mamani', 'Elena Rojas'],
  [Area.FINISHING]: ['Carmen Flores', 'Luis Vargas'],
  [Area.MANAGEMENT]: ['Patricia Díaz'],
};

const ROLE_BY_AREA: Record<string, string> = {
  [Area.ATTENTION]: RoleKey.ATTENTION,
  [Area.DESIGN]: RoleKey.DESIGN,
  [Area.PRODUCTION]: RoleKey.PRODUCTION,
  [Area.FINISHING]: RoleKey.FINISHING,
  [Area.MANAGEMENT]: RoleKey.MANAGEMENT,
};

type Scenario = {
  suffix: string;
  customer: string;
  phone?: string;
  address?: string;
  family: string;
  product: string;
  specifications: string;
  quantity: number;
  hasPlate?: boolean;
  /** Días desde hoy; negativo si la fecha de entrega ya pasó. */
  dueInDays: number;
  /** Estados por los que pasó la orden; el último es el actual. */
  path: string[];
  taskStatus?: string;
  completed?: number;
  incident?: string;
  note?: string;
};

const SCENARIOS: Scenario[] = [
  {
    suffix: 'DEMO0001',
    customer: 'Colegio San Agustín',
    phone: '987654321',
    address: 'Av. Los Próceres 245, Lima',
    family: 'editorial',
    product: 'Cancioneros de primera comunión',
    specifications: 'A5, tapa a color, interior blanco y negro, 24 páginas',
    quantity: 300,
    hasPlate: true,
    dueInDays: 12,
    path: [OrderStatus.DESIGN],
  },
  {
    suffix: 'DEMO0002',
    customer: 'Panadería La Espiga',
    phone: '956123478',
    address: 'Jr. Ayacucho 118, Lima',
    family: 'empaques',
    product: 'Bolsas',
    specifications: 'Bolsa kraft mediana con logo a una tinta',
    quantity: 2000,
    dueInDays: 8,
    path: [OrderStatus.DESIGN],
    taskStatus: TaskStatus.IN_PROGRESS,
    completed: 0,
    note: 'El cliente enviará el logo en vectores.',
  },
  {
    suffix: 'DEMO0003',
    customer: 'Clínica Santa Rosa',
    phone: '912345670',
    family: 'impresion-comercial',
    product: 'Dípticos',
    specifications: 'Couché 150 g, full color, doblez al centro',
    quantity: 1500,
    dueInDays: 6,
    path: [OrderStatus.DESIGN, OrderStatus.CUSTOMER_REVIEW],
    note: 'Propuesta enviada, pendiente de aprobación del cliente.',
  },
  {
    suffix: 'DEMO0004',
    customer: 'Restaurante El Tumi',
    phone: '945678123',
    address: 'Calle Las Flores 87, Miraflores',
    family: 'articulos-de-mesa',
    product: 'Individuales',
    specifications: 'Papel 90 g, full color, tamaño A3',
    quantity: 5000,
    dueInDays: 1,
    path: [OrderStatus.DESIGN, OrderStatus.PRODUCTION],
    taskStatus: TaskStatus.IN_PROGRESS,
    completed: 3200,
  },
  {
    suffix: 'DEMO0005',
    customer: 'Municipalidad de Surquillo',
    phone: '923456781',
    family: 'gran-formato',
    product: 'Banner',
    specifications: 'Lona 13 oz, 3 x 1 m, con ojales',
    quantity: 12,
    hasPlate: false,
    dueInDays: 3,
    path: [OrderStatus.DESIGN, OrderStatus.PRODUCTION],
    taskStatus: TaskStatus.BLOCKED,
    completed: 4,
    note: 'Se espera la reposición de lona para continuar.',
  },
  {
    suffix: 'DEMO0006',
    customer: 'Librería Mundo Escolar',
    phone: '934567812',
    family: 'editorial',
    product: 'Libretas',
    specifications: 'A6, 80 hojas, tapa dura',
    quantity: 800,
    hasPlate: true,
    dueInDays: -1,
    path: [OrderStatus.DESIGN, OrderStatus.PRODUCTION, OrderStatus.INCIDENT],
    incident: 'Máquina malograda',
  },
  {
    suffix: 'DEMO0007',
    customer: 'Cafetería Altura',
    phone: '967812345',
    address: 'Av. Benavides 1500, Miraflores',
    family: 'adhesivos',
    product: 'Stickers',
    specifications: 'Vinil blanco, 10 x 8 cm, troquelado',
    quantity: 1000,
    dueInDays: 4,
    path: [OrderStatus.DESIGN, OrderStatus.PRODUCTION, OrderStatus.FINISHING],
    taskStatus: TaskStatus.IN_PROGRESS,
    completed: 450,
  },
  {
    suffix: 'DEMO0008',
    customer: 'Inmobiliaria Horizonte',
    phone: '978123456',
    address: 'Av. Javier Prado 3200, San Borja',
    family: 'impresion-comercial',
    product: 'Afiches',
    specifications: 'Couché 200 g, A2, full color',
    quantity: 500,
    hasPlate: true,
    dueInDays: 2,
    path: [
      OrderStatus.DESIGN,
      OrderStatus.PRODUCTION,
      OrderStatus.FINISHING,
      OrderStatus.APPROVAL,
    ],
    completed: 500,
  },
  {
    suffix: 'DEMO0009',
    customer: 'Boutique Alpaca Fina',
    phone: '989012345',
    address: 'Jr. de la Unión 620, Lima',
    family: 'adhesivos',
    product: 'Etiquetas',
    specifications: 'Papel adhesivo mate, 5 x 3 cm',
    quantity: 3000,
    dueInDays: 1,
    path: [
      OrderStatus.DESIGN,
      OrderStatus.PRODUCTION,
      OrderStatus.FINISHING,
      OrderStatus.APPROVAL,
      OrderStatus.READY,
    ],
  },
  {
    suffix: 'DEMO0010',
    customer: 'Academia Pre Futuro',
    phone: '901234567',
    family: 'impresion-comercial',
    product: 'Volantes',
    specifications: 'Bond 75 g, media carta, una cara',
    quantity: 10000,
    dueInDays: 5,
    path: [OrderStatus.DESIGN, OrderStatus.RECEIVED],
    note: 'Devuelta a Atención para confirmar la cantidad con el cliente.',
  },
];

async function seedResponsibles(manager: EntityManager) {
  const names = new Map<string, ResponsibleEntity>();
  for (const [area, people] of Object.entries(RESPONSIBLES)) {
    for (const name of people) {
      const responsible =
        (await manager.findOneBy(ResponsibleEntity, {
          area,
          name,
          active: true,
        })) ??
        (await manager.save(
          manager.create(ResponsibleEntity, {
            area,
            name,
            email: null,
            active: true,
            createdAt: new Date(),
          }),
        ));
      names.set(area, names.get(area) ?? responsible);
    }
  }
  return names;
}

const actorFor = (area: string) => `${ROLE_BY_AREA[area]}@${ACCOUNT_DOMAIN}`;

async function seedOrder(
  manager: EntityManager,
  scenario: Scenario,
  responsibles: Map<string, ResponsibleEntity>,
  index: number,
) {
  const id = `ord-${scenario.suffix.toLowerCase()}`;
  if (await manager.existsBy(OrderEntity, { id })) return false;

  const { path } = scenario;
  const current = path[path.length - 1];
  const isReady = current === OrderStatus.READY;
  const now = Date.now();
  const stepMs = 5 * HOUR_MS;
  const createdAt = new Date(now - (path.length + 1) * stepMs - index * DAY_MS);
  const at = (step: number) => new Date(createdAt.getTime() + step * stepMs);
  const lastStep = path.length - 1;

  await manager.insert(OrderEntity, {
    id,
    number: `OT-${scenario.suffix}`,
    customerName: scenario.customer,
    customerPhone: scenario.phone ?? null,
    customerAddress: scenario.address ?? null,
    productFamily: scenario.family,
    productName: scenario.product,
    specifications: scenario.specifications,
    quantity: scenario.quantity,
    dueDate: new Date(now + scenario.dueInDays * DAY_MS)
      .toISOString()
      .slice(0, 10),
    hasPlate: scenario.hasPlate ?? false,
    summaryStatus: current,
    currentArea: orderStatusArea(current),
    createdAt,
    updatedAt: at(lastStep),
  });

  for (const [step, status] of path.entries()) {
    const area = orderStatusArea(status) as string;
    const previousArea =
      step > 0 ? (orderStatusArea(path[step - 1]) as string) : Area.ATTENTION;
    const isIncident = status === OrderStatus.INCIDENT;
    const isApproval = status === OrderStatus.READY;
    const responsible = responsibles.get(area) as ResponsibleEntity;

    if (!isApproval) {
      const isCurrent = step === lastStep;
      await manager.insert(OrderTaskEntity, {
        id: `task-${scenario.suffix.toLowerCase()}-${step + 1}`,
        orderId: id,
        area,
        status: isCurrent
          ? (scenario.taskStatus ?? TaskStatus.PENDING)
          : TaskStatus.COMPLETED,
        responsibleId: isIncident ? null : responsible.id,
        plannedQuantity: scenario.quantity,
        completedQuantity: isCurrent
          ? (scenario.completed ?? 0)
          : scenario.quantity,
        createdAt: at(step),
        updatedAt: at(step),
      });
    }

    const assignment = isIncident || isApproval;
    const text = isIncident
      ? `Incidencia reportada: ${scenario.incident}`
      : isApproval
        ? 'Orden aprobada y lista para entregar'
        : step === 0
          ? `Orden registrada y enviada a ${areaName(area)} — responsable: ${responsible.name}`
          : `Orden enviada al área ${areaName(area)} — responsable: ${responsible.name}`;
    await manager.insert(OrderEventEntity, {
      id: `evt-${scenario.suffix.toLowerCase()}-${step + 1}`,
      orderId: id,
      text,
      status,
      targetArea: area,
      assignmentAssignee: assignment ? null : responsible.name,
      assignmentArea: assignment ? null : area,
      actor: actorFor(previousArea),
      fromRole: ROLE_BY_AREA[previousArea],
      createdAt: at(step),
    });
  }

  if (scenario.note && !isReady) {
    const area = orderStatusArea(current) as string;
    await manager.insert(OrderEventEntity, {
      id: `evt-${scenario.suffix.toLowerCase()}-nota`,
      orderId: id,
      text: `Nota: ${scenario.note}`,
      actor: actorFor(area),
      fromRole: ROLE_BY_AREA[area],
      createdAt: new Date(at(lastStep).getTime() + HOUR_MS),
    });
  }
  return true;
}

/**
 * Datos ficticios para probar el sistema: responsables y una orden por cada
 * situación del flujo. Es idempotente y no adjunta archivos de Drive.
 */
async function seedDemo(): Promise<void> {
  assertTestSeedAllowed();
  await dataSource.initialize();
  try {
    const created = await dataSource.transaction(async (manager) => {
      const responsibles = await seedResponsibles(manager);
      let count = 0;
      for (const [index, scenario] of SCENARIOS.entries()) {
        if (await seedOrder(manager, scenario, responsibles, index)) count += 1;
      }
      return count;
    });
    console.log(`Órdenes creadas: ${created} de ${SCENARIOS.length}`);
  } finally {
    await dataSource.destroy();
  }
}

seedDemo().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
