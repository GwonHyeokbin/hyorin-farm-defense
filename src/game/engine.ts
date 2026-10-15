import type { Controls, EnemyKind, EnemyState, EngineEvent, GameState } from './types';
import { getAmmoDefinition } from './ammo';
import { getPetDefinition, PET_PATROLS } from './pets';

export const WORLD = { width: 1024, height: 640 } as const;
export const CROP_TARGETS = [
  { x: 343, y: 333, radius: 32 },
  { x: 505, y: 318, radius: 32 },
  { x: 674, y: 335, radius: 32 },
  { x: 505, y: 410, radius: 32 },
] as const;
export const FACILITY_TARGETS = [
  { id: 'barn', x: 190, y: 172, radius: 48 },
  { id: 'coop', x: 825, y: 181, radius: 38 },
  { id: 'silo', x: 871, y: 464, radius: 40 },
] as const;
const PLAYER_BLOCKERS = [
  { x: 190, y: 172, radius: 54 }, { x: 825, y: 181, radius: 46 }, { x: 870, y: 464, radius: 46 },
  { x: 63, y: 233, radius: 33 }, { x: 111, y: 208, radius: 37 }, { x: 926, y: 229, radius: 35 }, { x: 977, y: 204, radius: 37 },
  ...CROP_TARGETS.map((crop) => ({ x: crop.x, y: crop.y, radius: 46 })),
];

const ENEMY_INFO: Record<EnemyKind, { hp: number; speed: number; damage: number; score: number; resource: number; experience: number }> = {
  mole: { hp: 21, speed: 45, damage: 4, score: 90, resource: 2, experience: 12 },
  rabbit: { hp: 28, speed: 58, damage: 5, score: 120, resource: 3, experience: 16 },
  crow: { hp: 18, speed: 64, damage: 4, score: 110, resource: 2, experience: 14 },
  boar: { hp: 58, speed: 40, damage: 8, score: 250, resource: 5, experience: 32 },
  kingBoar: { hp: 260, speed: 47, damage: 14, score: 1600, resource: 25, experience: 120 },
};

export function createGameState(seed = Date.now() >>> 0): GameState {
  return {
    schemaVersion: 1,
    gameVersion: '1.0.0',
    seed: seed >>> 0 || 1,
    nextEnemyId: 1,
    wave: 0,
    score: 0,
    resources: 20,
    elapsed: 0,
    level: 1,
    experience: 0,
    experienceToNext: 100,
    ammo: 'bb',
    boulderUnlocked: false,
    pets: [],
    player: { x: 512, y: 500, hp: 100, maxHp: 100, attackCooldown: 0, meleeCooldown: 0, boulderCooldown: 0, invulnerable: 0, facingX: 0, facingY: -1 },
    upgrades: { power: 0, speed: 0, rapid: 0, armor: 0, vitality: 0, fence: 0 },
    farm: {
      health: 120,
      maxHealth: 120,
      crops: Array.from({ length: 4 }, () => ({ hp: 70, maxHp: 70 })),
      facilities: {
        barn: { hp: 120, maxHp: 120 },
        coop: { hp: 100, maxHp: 100 },
        silo: { hp: 110, maxHp: 110 },
      },
    },
    waveState: { phase: 'rest', total: 0, spawned: 0, spawnTimer: 0, phaseTimer: 2, elapsed: 0 },
    stats: { kills: 0, protectedCrops: 0, wavesCleared: 0 },
    enemies: [],
    projectiles: [],
  };
}

function random(state: GameState): number {
  state.seed = (state.seed + 0x6d2b79f5) >>> 0;
  let value = state.seed;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function beginWave(state: GameState): EngineEvent {
  state.wave += 1;
  state.waveState = {
    phase: 'defend',
    total: Math.min(2 + Math.ceil(state.wave), 12) + (state.wave % 5 === 0 ? 1 : 0),
    spawned: 0,
    spawnTimer: 0.6,
    phaseTimer: 0,
    elapsed: 0,
  };
  return { type: 'wave-start', text: `제${state.wave}웨이브 시작!` };
}

function chooseTarget(state: GameState, kind: EnemyKind): number {
  if (kind === 'crow') return Math.floor(random(state) * CROP_TARGETS.length);
  if (kind === 'rabbit') return Math.floor(random(state) * CROP_TARGETS.length);
  if (kind === 'mole') return Math.floor(random(state) * CROP_TARGETS.length);
  return CROP_TARGETS.length + Math.floor(random(state) * FACILITY_TARGETS.length);
}

function spawnEnemy(state: GameState): void {
  const choice = random(state);
  let kind: EnemyKind;
  if (state.wave % 5 === 0 && state.waveState.spawned === state.waveState.total - 1) kind = 'kingBoar';
  else if (state.wave < 2) kind = choice < 0.55 ? 'mole' : 'rabbit';
  else if (choice < 0.27) kind = 'mole';
  else if (choice < 0.53) kind = 'rabbit';
  else if (choice < 0.78) kind = 'crow';
  else kind = 'boar';

  const edge = Math.floor(random(state) * 4);
  const x = edge === 0 ? -18 : edge === 1 ? WORLD.width + 18 : random(state) * WORLD.width;
  const y = edge === 2 ? -18 : edge === 3 ? WORLD.height + 18 : random(state) * WORLD.height;
  const info = ENEMY_INFO[kind];
  const difficulty = 1 + (state.wave - 1) * 0.04;
  const targetIndex = chooseTarget(state, kind);
  const enemy: EnemyState = {
    id: state.nextEnemyId++,
    kind,
    x,
    y,
    hp: Math.round(info.hp * difficulty),
    maxHp: Math.round(info.hp * difficulty),
    speed: info.speed * Math.min(1.18, 1 + (state.wave - 1) * 0.01),
    targetIndex,
    mood: kind === 'mole' ? 'burrow' : kind === 'crow' ? 'dive' : 'seek',
    moodTimer: kind === 'mole' ? 1.1 : kind === 'crow' ? 1.5 : kind === 'boar' ? 2.2 : 0,
    attackCooldown: 1.2,
    contactCooldown: 0,
    hitFlash: 0,
    status: null,
    statusTimer: 0,
  };
  state.enemies.push(enemy);
  state.waveState.spawned += 1;
}

function getTarget(state: GameState, enemy: EnemyState): { x: number; y: number; radius: number; cropIndex?: number; facilityId?: string } {
  if (enemy.targetIndex < CROP_TARGETS.length && state.farm.crops[enemy.targetIndex].hp > 0) {
    return { ...CROP_TARGETS[enemy.targetIndex], cropIndex: enemy.targetIndex };
  }
  const facilityIndex = Math.max(0, enemy.targetIndex - CROP_TARGETS.length) % FACILITY_TARGETS.length;
  const facility = FACILITY_TARGETS[facilityIndex];
  if (state.farm.facilities[facility.id].hp > 0) return { ...facility, facilityId: facility.id };
  const fallback = CROP_TARGETS.findIndex((_, i) => state.farm.crops[i].hp > 0);
  if (fallback >= 0) return { ...CROP_TARGETS[fallback], cropIndex: fallback };
  return { ...FACILITY_TARGETS[0], facilityId: 'barn' };
}

function getNearestEnemy(state: GameState, x: number, y: number): { enemy: EnemyState; distance: number } | null {
  let nearest: { enemy: EnemyState; distance: number } | null = null;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || (enemy.kind === 'mole' && enemy.mood === 'burrow')) continue;
    const distance = Math.hypot(enemy.x - x, enemy.y - y);
    if (!nearest || distance < nearest.distance) nearest = { enemy, distance };
  }
  return nearest;
}

function spawnProjectile(state: GameState): boolean {
  const { player } = state;
  const nearest = getNearestEnemy(state, player.x, player.y);
  if (!nearest || nearest.distance > 900) return false;
  const target = nearest.enemy;
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const length = Math.hypot(dx, dy) || 1;
  const ammo = getAmmoDefinition(state.ammo);
  const damage = ammo.damage * (1 + state.upgrades.power * 0.12);
  state.projectiles.push({
    x: player.x + dx / length * 16,
    y: player.y + dy / length * 16,
    vx: dx / length * ammo.speed,
    vy: dy / length * ammo.speed,
    damage,
    life: 1.6,
    ammo: state.ammo,
    targetId: target.id,
  });
  player.facingX = dx / length;
  player.facingY = dy / length;
  return true;
}

function increaseExperience(state: GameState, amount: number, events: EngineEvent[]): void {
  state.experience += amount;
  while (state.experience >= state.experienceToNext) {
    state.experience -= state.experienceToNext;
    state.level += 1;
    state.experienceToNext = state.level * 100;
    events.push({ type: 'level-up', text: `레벨 ${state.level}! 공격 속도 +1%` });
  }
}

function damageEnemy(state: GameState, enemy: EnemyState, amount: number, events: EngineEvent[]): void {
  if (enemy.hp <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - amount);
  enemy.hitFlash = 0.14;
  events.push({ type: 'hit' });
  if (enemy.hp > 0) return;
  state.score += ENEMY_INFO[enemy.kind].score;
  state.resources += ENEMY_INFO[enemy.kind].resource;
  state.stats.kills += 1;
  increaseExperience(state, ENEMY_INFO[enemy.kind].experience, events);
  if (CROP_TARGETS.some((crop) => Math.hypot(enemy.x - crop.x, enemy.y - crop.y) < 180)) state.stats.protectedCrops += 1;
  events.push({ type: 'kill' });
}

function applyEnemyStatus(enemy: EnemyState, status: NonNullable<EnemyState['status']>, seconds: number): void {
  enemy.status = status;
  enemy.statusTimer = Math.max(enemy.statusTimer ?? 0, seconds);
}

function attackWithLargeStone(state: GameState, events: EngineEvent[]): void {
  const { player } = state;
  if (player.meleeCooldown > 0) return;
  const target = state.enemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy) => ({ enemy, distance: Math.hypot(enemy.x - player.x, enemy.y - player.y) }))
    .filter((entry) => entry.distance <= 68)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!target) return;
  const rate = (1 + (state.level - 1) * 0.01) * (1 + state.upgrades.rapid * 0.08);
  player.meleeCooldown = 1.15 / rate;
  applyEnemyStatus(target.enemy, 'groggy', 1.4);
  events.push({ type: 'melee' }, { type: 'groggy' });
  damageEnemy(state, target.enemy, 34 * (1 + state.upgrades.power * 0.12), events);
}

function attackWithBoulder(state: GameState, events: EngineEvent[]): void {
  const { player } = state;
  if (!state.boulderUnlocked || player.boulderCooldown > 0) return;
  const targets = state.enemies
    .filter((enemy) => enemy.hp > 0 && Math.hypot(enemy.x - player.x, enemy.y - player.y) <= 92)
    .slice(0, 4);
  if (targets.length === 0) return;
  const rate = (1 + (state.level - 1) * 0.01) * (1 + state.upgrades.rapid * 0.08);
  player.boulderCooldown = 5.5 / rate;
  events.push({ type: 'boulder', text: '바위 강타!' });
  for (const enemy of targets) {
    applyEnemyStatus(enemy, 'stun', 1.1);
    events.push({ type: 'stun' });
    damageEnemy(state, enemy, 46 * (1 + state.upgrades.power * 0.12), events);
  }
}

function damageFarm(state: GameState, enemy: EnemyState): void {
  const rawDamage = ENEMY_INFO[enemy.kind].damage;
  const reduction = state.upgrades.fence * 0.07;
  const damage = Math.max(2, Math.round(rawDamage * (1 - reduction)));
  const target = getTarget(state, enemy);
  state.farm.health = Math.max(0, state.farm.health - damage);
  if (target.cropIndex !== undefined) {
    const crop = state.farm.crops[target.cropIndex];
    crop.hp = Math.max(0, crop.hp - Math.ceil(damage * 0.7));
  }
  if (target.facilityId) {
    const facility = state.farm.facilities[target.facilityId];
    facility.hp = Math.max(0, facility.hp - damage);
  }
}

function updateEnemy(state: GameState, enemy: EnemyState, dt: number, events: EngineEvent[]): void {
  const target = getTarget(state, enemy);
  enemy.moodTimer = Math.max(0, enemy.moodTimer - dt);
  enemy.statusTimer = Math.max(0, (enemy.statusTimer ?? 0) - dt);
  if (enemy.statusTimer <= 0) enemy.status = null;
  enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt * (enemy.status === 'groggy' ? 0.4 : 1));
  enemy.contactCooldown = Math.max(0, enemy.contactCooldown - dt);
  enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
  if (enemy.status === 'stun') return;

  if (enemy.kind === 'mole' && enemy.mood === 'burrow') {
    if (enemy.moodTimer <= 0) {
      enemy.x = PhaserMathClamp(target.x + (random(state) - 0.5) * 130, 45, WORLD.width - 45);
      enemy.y = PhaserMathClamp(target.y + (random(state) - 0.5) * 100, 55, WORLD.height - 55);
      enemy.mood = 'seek';
      enemy.moodTimer = 0;
    }
    return;
  }

  let speed = enemy.speed * (enemy.status === 'groggy' ? 0.4 : 1);
  if (enemy.kind === 'crow' && enemy.mood === 'dive') {
    speed *= 1.5;
    if (enemy.moodTimer <= 0) { enemy.moodTimer = 2.8; enemy.mood = 'seek'; }
  } else if (enemy.kind === 'crow' && enemy.moodTimer <= 0) {
    enemy.mood = 'dive';
    enemy.moodTimer = 0.8;
  }
  if (enemy.kind === 'boar' || enemy.kind === 'kingBoar') {
    if (enemy.moodTimer <= 0) {
      enemy.mood = enemy.mood === 'charge' ? 'seek' : 'charge';
      enemy.moodTimer = enemy.mood === 'charge' ? 0.95 : 2.7;
    }
    if (enemy.mood === 'charge') speed *= enemy.kind === 'kingBoar' ? 3.2 : 2.7;
  }

  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const distance = Math.hypot(dx, dy) || 1;
  const attackRange = target.radius + (enemy.kind === 'crow' ? 6 : 2);
  if (distance > attackRange) {
    enemy.x = PhaserMathClamp(enemy.x + dx / distance * speed * dt, -24, WORLD.width + 24);
    enemy.y = PhaserMathClamp(enemy.y + dy / distance * speed * dt, -24, WORLD.height + 24);
  } else if (enemy.attackCooldown <= 0) {
    damageFarm(state, enemy);
    enemy.attackCooldown = enemy.kind === 'kingBoar' ? 1.15 : enemy.kind === 'crow' ? 1.4 : 1.65;
    events.push({ type: 'farm-hit' });
  }

  const contactX = state.player.x - enemy.x;
  const contactY = state.player.y - enemy.y;
  const playerDistance = Math.hypot(contactX, contactY);
  if (playerDistance < 34) {
    const distance = playerDistance || 1;
    const pushed = movePlayerAroundBlockers(
      PhaserMathClamp(enemy.x + contactX / distance * 34, 38, WORLD.width - 38),
      PhaserMathClamp(enemy.y + contactY / distance * 34, 66, WORLD.height - 38),
      state.player.x,
      state.player.y,
    );
    state.player.x = pushed.x;
    state.player.y = pushed.y;
    if (enemy.contactCooldown <= 0 && state.player.invulnerable <= 0) {
      const damage = Math.max(2, Math.ceil(ENEMY_INFO[enemy.kind].damage * 0.8) - state.upgrades.armor * 2);
      state.player.hp = Math.max(0, state.player.hp - damage);
      state.player.invulnerable = 0.65;
      enemy.contactCooldown = 1.5;
      events.push({ type: 'player-hit' });
    }
  }
}

function updatePets(state: GameState, dt: number, events: EngineEvent[]): void {
  for (const pet of state.pets) {
    const definition = getPetDefinition(pet.type);
    pet.attackCooldown = Math.max(0, pet.attackCooldown - dt);
    const target = state.enemies
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => ({ enemy, distance: Math.hypot(enemy.x - pet.x, enemy.y - pet.y) }))
      .filter((entry) => entry.distance <= 250)
      .sort((a, b) => a.distance - b.distance)[0];

    if (target && target.distance <= 46) {
      const dx = target.enemy.x - pet.x;
      const dy = target.enemy.y - pet.y;
      const length = Math.hypot(dx, dy) || 1;
      pet.facingX = dx / length;
      pet.facingY = dy / length;
      if (pet.attackCooldown <= 0) {
        pet.attackCooldown = definition.attackCooldown;
        damageEnemy(state, target.enemy, definition.damage * (1 + state.upgrades.power * 0.06), events);
      }
      continue;
    }

    const route = PET_PATROLS[pet.type];
    const destination = target?.enemy ?? route[pet.patrolIndex % route.length];
    const dx = destination.x - pet.x;
    const dy = destination.y - pet.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 13) {
      if (!target) pet.patrolIndex = (pet.patrolIndex + 1) % route.length;
      continue;
    }

    const length = Math.max(1, distance);
    const stepDistance = Math.min(distance, definition.speed * dt);
    const next = movePlayerAroundBlockers(
      PhaserMathClamp(pet.x + dx / length * stepDistance, 38, WORLD.width - 38),
      PhaserMathClamp(pet.y + dy / length * stepDistance, 66, WORLD.height - 38),
      pet.x,
      pet.y,
    );
    const movedX = next.x - pet.x;
    const movedY = next.y - pet.y;
    if (Math.hypot(movedX, movedY) > 0.1) {
      pet.x = next.x;
      pet.y = next.y;
      const movedLength = Math.hypot(movedX, movedY);
      pet.facingX = movedX / movedLength;
      pet.facingY = movedY / movedLength;
    } else if (!target) {
      pet.patrolIndex = (pet.patrolIndex + 1) % route.length;
    }
  }
}

function PhaserMathClamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function movePlayerAroundBlockers(x: number, y: number, fallbackX: number, fallbackY: number): { x: number; y: number } {
  let result = { x, y };
  for (let pass = 0; pass < 2; pass += 1) {
    for (const blocker of PLAYER_BLOCKERS) {
      const dx = result.x - blocker.x;
      const dy = result.y - blocker.y;
      const distance = Math.hypot(dx, dy);
      const minimum = blocker.radius + 12;
      if (distance >= minimum) continue;
      let nx = dx / (distance || 1);
      let ny = dy / (distance || 1);
      if (distance < 0.01) {
        nx = fallbackX - blocker.x;
        ny = fallbackY - blocker.y;
        const fallbackDistance = Math.hypot(nx, ny) || 1;
        nx /= fallbackDistance;
        ny /= fallbackDistance;
      }
      result = { x: PhaserMathClamp(blocker.x + nx * minimum, 38, WORLD.width - 38), y: PhaserMathClamp(blocker.y + ny * minimum, 66, WORLD.height - 38) };
    }
  }
  return result;
}

export function stepWorld(state: GameState, rawDt: number, controls: Controls = {}): EngineEvent[] {
  const dt = Math.max(0, Math.min(rawDt, 0.05));
  if (dt === 0 || state.farm.health <= 0 || state.player.hp <= 0) return [];
  const events: EngineEvent[] = [];
  state.elapsed += dt;
  state.player.invulnerable = Math.max(0, state.player.invulnerable - dt);
  state.player.attackCooldown = Math.max(0, state.player.attackCooldown - dt);
  state.player.meleeCooldown = Math.max(0, state.player.meleeCooldown - dt);
  state.player.boulderCooldown = Math.max(0, state.player.boulderCooldown - dt);

  let vx = Number(Boolean(controls.right)) - Number(Boolean(controls.left));
  let vy = Number(Boolean(controls.down)) - Number(Boolean(controls.up));
  if (Number.isFinite(controls.moveToX) && Number.isFinite(controls.moveToY)) {
    vx = controls.moveToX! - state.player.x;
    vy = controls.moveToY! - state.player.y;
    if (Math.hypot(vx, vy) <= 8) { vx = 0; vy = 0; }
  }
  const length = Math.hypot(vx, vy) || 1;
  const moveSpeed = 185 + state.upgrades.speed * 15;
  const previousX = state.player.x;
  const previousY = state.player.y;
  const nextX = PhaserMathClamp(previousX + vx / length * moveSpeed * dt, 38, WORLD.width - 38);
  const nextY = PhaserMathClamp(previousY + vy / length * moveSpeed * dt, 66, WORLD.height - 38);
  const safePosition = movePlayerAroundBlockers(nextX, nextY, previousX, previousY);
  state.player.x = safePosition.x;
  state.player.y = safePosition.y;
  const nearestEnemy = getNearestEnemy(state, state.player.x, state.player.y);
  if (nearestEnemy && nearestEnemy.distance <= 900) {
    const aimX = nearestEnemy.enemy.x - state.player.x;
    const aimY = nearestEnemy.enemy.y - state.player.y;
    const aimLength = Math.hypot(aimX, aimY) || 1;
    state.player.facingX = aimX / aimLength;
    state.player.facingY = aimY / aimLength;
  } else if (vx || vy) {
    state.player.facingX = vx / length;
    state.player.facingY = vy / length;
  }

  if (controls.attack && state.player.attackCooldown <= 0) {
    if (spawnProjectile(state)) {
      events.push({ type: 'fire' });
      const rate = (1 + (state.level - 1) * 0.01) * (1 + state.upgrades.rapid * 0.08);
      state.player.attackCooldown = 0.48 / rate;
    }
  }

  if (state.waveState.phase === 'rest') {
    state.waveState.phaseTimer -= dt;
    if (state.waveState.phaseTimer <= 0) events.push(beginWave(state));
  } else {
    state.waveState.elapsed += dt;
    if (state.waveState.spawned < state.waveState.total) {
      state.waveState.spawnTimer = Math.max(0, state.waveState.spawnTimer - dt);
      if (state.waveState.spawnTimer <= 0 && state.enemies.length < 14) {
        spawnEnemy(state);
        state.waveState.spawnTimer = Math.max(1.9, 2.8 - state.wave * 0.04);
      }
    }
  }

  for (const enemy of state.enemies) updateEnemy(state, enemy, dt, events);
  updatePets(state, dt, events);
  attackWithLargeStone(state, events);
  attackWithBoulder(state, events);
  const remainingProjectiles: GameState['projectiles'] = [];
  for (const projectile of state.projectiles) {
    let target = projectile.targetId === undefined
      ? undefined
      : state.enemies.find((enemy) => enemy.id === projectile.targetId && enemy.hp > 0);
    if (!target) {
      target = getNearestEnemy(state, projectile.x, projectile.y)?.enemy;
      if (target) projectile.targetId = target.id;
    }
    if (target) {
      const dx = target.x - projectile.x;
      const dy = target.y - projectile.y;
      const distance = Math.hypot(dx, dy) || 1;
      const speed = Math.hypot(projectile.vx, projectile.vy) || getAmmoDefinition(projectile.ammo ?? 'bb').speed;
      projectile.vx = dx / distance * speed;
      projectile.vy = dy / distance * speed;
    }
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;
    let hit = false;
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0) continue;
      if (Math.hypot(enemy.x - projectile.x, enemy.y - projectile.y) > (enemy.kind === 'kingBoar' ? 29 : 21)) continue;
      if (projectile.ammo === 'stone') {
        const awayX = enemy.x - projectile.x;
        const awayY = enemy.y - projectile.y;
        const awayLength = Math.hypot(awayX, awayY) || 1;
        enemy.x = PhaserMathClamp(enemy.x + awayX / awayLength * 48, -12, WORLD.width + 12);
        enemy.y = PhaserMathClamp(enemy.y + awayY / awayLength * 48, -12, WORLD.height + 12);
        applyEnemyStatus(enemy, 'knockback', 0.24);
        events.push({ type: 'knockback' });
      }
      damageEnemy(state, enemy, projectile.damage, events);
      hit = true;
      break;
    }
    if (!hit && projectile.life > 0 && projectile.x > -20 && projectile.x < WORLD.width + 20 && projectile.y > -20 && projectile.y < WORLD.height + 20) remainingProjectiles.push(projectile);
  }
  state.projectiles = remainingProjectiles;
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);

  if (state.waveState.phase === 'defend' && state.waveState.spawned >= state.waveState.total && state.enemies.length === 0) {
    state.waveState.phase = 'rest';
    state.waveState.phaseTimer = 12;
    state.player.hp = state.player.maxHp;
    state.player.attackCooldown = 0;
    state.player.meleeCooldown = 0;
    state.player.boulderCooldown = 0;
    state.player.invulnerable = 0;
    state.projectiles = [];
    state.score += state.wave * 350;
    state.resources += 12 + Math.min(20, state.wave * 2);
    state.stats.wavesCleared += 1;
    state.farm.health = Math.min(state.farm.maxHealth, state.farm.health + 6);
    for (const crop of state.farm.crops) crop.hp = Math.min(crop.maxHp, crop.hp + 8);
    events.push({ type: 'wave-clear', text: `제${state.wave}웨이브 방어 성공!` });
  }

  if (state.farm.health <= 0 || state.player.hp <= 0) events.push({ type: 'game-over' });
  return events;
}

export function restoreSafeCheckpoint(state: GameState): GameState {
  return {
    ...structuredClone(state),
    enemies: [],
    projectiles: [],
    waveState: { phase: 'rest', total: 0, spawned: 0, spawnTimer: 0, phaseTimer: 8, elapsed: state.waveState.elapsed },
  };
}

