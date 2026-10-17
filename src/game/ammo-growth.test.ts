import { describe, expect, it } from 'vitest';
import { createAmmoCounts, refillAmmo } from './ammo';
import { createGameState, stepWorld } from './engine';
import { growthStageForHealth, hyorinAnimationFrameCount } from './growth';

describe('ammo stock and age display', () => {
  it('keeps adult poses static because the adult sheets are pose collections, not animation cycles', () => {
    for (const animation of ['idle', 'move', 'attack', 'hit'] as const) {
      expect(hyorinAnimationFrameCount(4, animation)).toBe(1);
    }
    expect(hyorinAnimationFrameCount(3, 'move')).toBe(5);
    expect(hyorinAnimationFrameCount(1, 'attack')).toBe(4);
  });

  it('starts with the Defense 2 capacities and charges points to refill a partial stack', () => {
    const state = createGameState(5);
    expect(state.ammoCounts).toEqual(createAmmoCounts());
    state.ammoCounts.bb = 9;
    expect(refillAmmo(state, 'bb')).toBe(true);
    expect(state.ammoCounts.bb).toBe(30);
    expect(state.resources).toBe(14);
    expect(state.ammo).toBe('bb');
    expect(refillAmmo(state, 'bb')).toBe(false);
  });

  it.each([
    [100, 100, 4], [76, 100, 4], [75, 100, 3], [51, 100, 3],
    [50, 100, 2], [26, 100, 2], [25, 100, 1], [1, 100, 1], [0, 100, 1],
  ] as const)('maps health %i/%i to age sprite stage %i', (hp, maxHp, stage) => {
    expect(growthStageForHealth(hp, maxHp)).toBe(stage);
  });

  it('does not fire a free shot after all ammunition is exhausted', () => {
    const state = createGameState(8);
    state.waveState = { phase: 'defend', total: 1, spawned: 1, spawnTimer: 0, phaseTimer: 0, elapsed: 0 };
    state.enemies = [{ id: 1, kind: 'boar', x: 710, y: 500, hp: 1000, maxHp: 1000, speed: 0, targetIndex: 0, mood: 'seek', moodTimer: 100, attackCooldown: 100, contactCooldown: 100, hitFlash: 0 }];
    state.ammoCounts = { bb: 0, steelBb: 0, stone: 0 };

    const events = stepWorld(state, 0.05, { attack: true });

    expect(events.some((event) => event.type === 'fire')).toBe(false);
    expect(state.projectiles).toEqual([]);
  });
});
