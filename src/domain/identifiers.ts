import { randomInt, randomUUID } from 'node:crypto';

const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ORDER_NUMBER_LENGTH = 8;

const hexId = () => randomUUID().replaceAll('-', '');

export function generateOrderIdentity(): { number: string; id: string } {
  let suffix = '';
  for (let index = 0; index < ORDER_NUMBER_LENGTH; index += 1) {
    suffix += ORDER_NUMBER_ALPHABET[randomInt(ORDER_NUMBER_ALPHABET.length)];
  }
  return { number: `OT-${suffix}`, id: `ord-${suffix.toLowerCase()}` };
}

export const generateTaskId = () => `task-${hexId()}`;

export const generateEventId = () => `evt-${hexId()}`;
