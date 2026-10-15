import type { AmmoType } from './types';

export interface AmmoDefinition {
  type: AmmoType;
  name: string;
  icon: string;
  description: string;
  speed: number;
  damage: number;
}

export const AMMO_DEFINITIONS: AmmoDefinition[] = [
  { type: 'bb', name: 'BB탄', icon: '⚪', description: '빠름 · 약한 피해', speed: 650, damage: 20 },
  { type: 'steelBb', name: '강철 BB탄', icon: '🔘', description: '매우 빠름 · 조금 강함', speed: 740, damage: 28 },
  { type: 'stone', name: '돌맹이', icon: '🪨', description: '맞으면 넉백', speed: 500, damage: 32 },
];

export function getAmmoDefinition(type: AmmoType): AmmoDefinition {
  return AMMO_DEFINITIONS.find((definition) => definition.type === type) ?? AMMO_DEFINITIONS[0];
}

export function isAmmoType(value: unknown): value is AmmoType {
  return value === 'bb' || value === 'steelBb' || value === 'stone';
}
