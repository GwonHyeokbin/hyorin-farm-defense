import type { AmmoType, GameState } from './types';

export interface AmmoDefinition {
  type: AmmoType;
  name: string;
  icon: string;
  description: string;
  speed: number;
  damage: number;
  capacity: number;
  refillCost: number;
}

export const AMMO_DEFINITIONS: AmmoDefinition[] = [
  { type: 'bb', name: 'BB탄', icon: '⚪', description: '빠름 · 약한 피해', speed: 650, damage: 20, capacity: 30, refillCost: 6 },
  { type: 'steelBb', name: '강철 BB탄', icon: '🔘', description: '매우 빠름 · 조금 강함', speed: 740, damage: 28, capacity: 10, refillCost: 8 },
  { type: 'stone', name: '돌맹이', icon: '🪨', description: '맞으면 넉백', speed: 500, damage: 32, capacity: 3, refillCost: 6 },
];

export const AMMO_CAPACITIES: Record<AmmoType, number> = Object.fromEntries(AMMO_DEFINITIONS.map(({ type, capacity }) => [type, capacity])) as Record<AmmoType, number>;

export function createAmmoCounts(): Record<AmmoType, number> {
  return { ...AMMO_CAPACITIES };
}

export function normalizeAmmoCounts(counts?: Partial<Record<AmmoType, number>>): Record<AmmoType, number> {
  return Object.fromEntries(AMMO_DEFINITIONS.map(({ type, capacity }) => {
    const count = counts?.[type];
    return [type, Number.isFinite(count) ? Math.min(capacity, Math.max(0, Math.floor(count as number))) : capacity];
  })) as Record<AmmoType, number>;
}

export function refillAmmo(state: Pick<GameState, 'resources' | 'ammoCounts' | 'ammo'>, type: AmmoType): boolean {
  const definition = getAmmoDefinition(type);
  if (state.ammoCounts[type] >= definition.capacity || state.resources < definition.refillCost) return false;
  state.resources -= definition.refillCost;
  state.ammoCounts[type] = definition.capacity;
  state.ammo = type;
  return true;
}

export function getAmmoDefinition(type: AmmoType): AmmoDefinition {
  return AMMO_DEFINITIONS.find((definition) => definition.type === type) ?? AMMO_DEFINITIONS[0];
}

export function isAmmoType(value: unknown): value is AmmoType {
  return value === 'bb' || value === 'steelBb' || value === 'stone';
}
