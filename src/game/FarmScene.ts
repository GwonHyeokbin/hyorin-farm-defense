import Phaser from 'phaser';
import { CROP_TARGETS, createGameState, stepWorld, WORLD } from './engine';
import { applyUpgrade, repairFarm, unlockBoulder } from './upgrades';
import type { AmmoType, Controls, EngineEvent, GameState, PetType } from './types';
import { purchasePet } from './pets';

export interface FarmSceneCallbacks {
  onSnapshot: (state: GameState) => void;
  onEvent: (event: EngineEvent, state: GameState) => void;
  onGameOver: (state: GameState) => void;
  onPause: (state: GameState) => void;
  onReady: () => void;
  onAutosave: (state: GameState) => void;
}

const SPRITES = {
  mole: 'mole',
  rabbit: 'rabbit',
  crow: 'crow',
  boar: 'boar',
  kingBoar: 'king-boar',
} as const;

export class FarmScene extends Phaser.Scene {
  private readonly callbacks: FarmSceneCallbacks;
  private state: GameState | null = null;
  private paused = true;
  private pauseKey?: Phaser.Input.Keyboard.Key;
  private playerSprite?: Phaser.GameObjects.Image;
  private slingshotSprite?: Phaser.GameObjects.Image;
  private stoneSprite?: Phaser.GameObjects.Image;
  private readonly enemySprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly enemyStatusSprites = new Map<number, Phaser.GameObjects.Text>();
  private readonly petSprites = new Map<PetType, Phaser.GameObjects.Image>();
  private readonly previousPetPositions = new Map<PetType, { x: number; y: number }>();
  private readonly projectileSprites: Phaser.GameObjects.Image[] = [];
  private bars: Phaser.GameObjects.Graphics | null = null;
  private pointerAttack = false;
  private pointerX = 512;
  private pointerY = 500;
  private meleeEffectTimer = 0;
  private meleeEffectKind: 'stone' | 'boulder' | null = null;
  private hudTimer = 0;
  private autosaveTimer = 0;
  private lastAutosaveWave = -1;
  private ended = false;
  private moving = false;

  constructor(callbacks: FarmSceneCallbacks) {
    super({ key: 'FarmScene' });
    this.callbacks = callbacks;
  }

  preload(): void {
    const root = import.meta.env.BASE_URL + 'art/';
    this.load.svg('farm-background', root + 'farm.svg', { width: WORLD.width, height: WORLD.height });
    this.load.image('hyorin', root + 'hyorin-2d.png');
    this.load.image('pet-nuni', root + 'pet-nuni.png');
    this.load.image('pet-yangi', root + 'pet-yangi.png');
    this.load.image('pet-maru', root + 'pet-maru.png');
    this.load.svg('slingshot', root + 'slingshot.svg', { width: 48, height: 64 });
    this.load.svg('mole', root + 'mole.svg', { width: 72, height: 68 });
    this.load.svg('rabbit', root + 'rabbit.svg', { width: 68, height: 76 });
    this.load.svg('crow', root + 'crow.svg', { width: 78, height: 62 });
    this.load.svg('boar', root + 'boar.svg', { width: 84, height: 72 });
    this.load.svg('king-boar', root + 'king-boar.svg', { width: 112, height: 98 });
    this.load.svg('bb-pellet', root + 'bb-pellet.svg', { width: 32, height: 32 });
    this.load.svg('steel-bb-pellet', root + 'steel-bb-pellet.svg', { width: 32, height: 32 });
    this.load.svg('stone-pellet', root + 'stone-pellet.svg', { width: 32, height: 32 });
    this.load.svg('large-stone', root + 'large-stone.svg', { width: 40, height: 40 });
    this.load.svg('boulder', root + 'boulder.svg', { width: 64, height: 64 });
  }

  create(): void {
    this.add.image(WORLD.width / 2, WORLD.height / 2, 'farm-background').setDisplaySize(WORLD.width, WORLD.height).setDepth(0);
    this.playerSprite = this.add.image(512, 500, 'hyorin').setDisplaySize(80, 120).setOrigin(0.5, 0.75).setDepth(500);
    this.slingshotSprite = this.add.image(538, 532, 'slingshot').setDisplaySize(24, 32).setDepth(530);
    this.stoneSprite = this.add.image(512, 500, 'large-stone').setDisplaySize(28, 28).setVisible(false).setDepth(560);
    this.bars = this.add.graphics().setDepth(900);
    this.pauseKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown() && this.state && !this.paused) {
        this.pointerAttack = true;
        this.updatePointerTarget(pointer);
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.updatePointerTarget(pointer));
    this.input.on('pointerup', () => { this.pointerAttack = false; });
    this.input.on('gameout', () => { this.pointerAttack = false; });
    this.callbacks.onReady();
  }

  private updatePointerTarget(pointer: Phaser.Input.Pointer): void {
    this.pointerX = Phaser.Math.Clamp(pointer.worldX, 0, WORLD.width);
    this.pointerY = Phaser.Math.Clamp(pointer.worldY, 0, WORLD.height);
  }

  startRun(snapshot?: GameState): GameState {
    this.clearWorldSprites();
    this.state = snapshot ? structuredClone(snapshot) : createGameState();
    this.paused = false;
    this.pointerAttack = false;
    this.ended = false;
    this.hudTimer = 0;
    this.autosaveTimer = 0;
    this.lastAutosaveWave = this.state.wave;
    this.renderState();
    this.publishSnapshot();
    return this.snapshot();
  }

  snapshot(): GameState {
    if (!this.state) return createGameState();
    return structuredClone(this.state);
  }

  pauseRun(): GameState {
    this.paused = true;
    this.pointerAttack = false;
    const state = this.snapshot();
    this.callbacks.onPause(state);
    return state;
  }

  resumeRun(): void {
    this.paused = false;
  }

  selectAmmo(ammo: AmmoType): void {
    if (!this.state || this.state.ammo === ammo) return;
    this.state.ammo = ammo;
    this.publishSnapshot();
    this.callbacks.onAutosave(this.snapshot());
  }

  continueFromRest(): void {
    if (this.state) this.state.waveState.phaseTimer = 0;
    this.paused = false;
  }

  purchaseUpgrade(key: Parameters<typeof applyUpgrade>[1]): boolean {
    if (!this.state || !applyUpgrade(this.state, key)) return false;
    this.renderState();
    this.publishSnapshot();
    this.callbacks.onAutosave(this.snapshot());
    return true;
  }

  purchaseBoulder(): boolean {
    if (!this.state || !unlockBoulder(this.state)) return false;
    this.renderState();
    this.publishSnapshot();
    this.callbacks.onAutosave(this.snapshot());
    return true;
  }

  purchasePet(type: PetType): boolean {
    if (!this.state || !purchasePet(this.state, type)) return false;
    this.renderState();
    this.publishSnapshot();
    this.callbacks.onAutosave(this.snapshot());
    return true;
  }

  repairRun(): boolean {
    if (!this.state || !repairFarm(this.state)) return false;
    this.renderState();
    this.publishSnapshot();
    this.callbacks.onAutosave(this.snapshot());
    return true;
  }

  private controls(): Controls {
    return {
      attack: this.pointerAttack,
      ...(this.pointerAttack ? { moveToX: this.pointerX, moveToY: this.pointerY } : {}),
    };
  }

  update(_time: number, deltaMs: number): void {
    if (!this.state || this.paused || this.ended) return;
    if (this.pauseKey?.isDown) {
      this.pauseKey.reset();
      this.pauseRun();
      return;
    }
    // A hidden tab must not advance waves by a large timer jump when it is shown again.
    if (deltaMs > 220) return;
    const dt = Math.min(deltaMs / 1000, 0.05);
    const controls = this.controls();
    this.moving = Boolean(controls.moveToX !== undefined && Math.hypot(controls.moveToX - this.state.player.x, controls.moveToY! - this.state.player.y) > 8);
    this.meleeEffectTimer = Math.max(0, this.meleeEffectTimer - dt);
    const events = stepWorld(this.state, dt, controls);
    this.renderState();
    for (const event of events) {
      if (event.type === 'melee') { this.meleeEffectTimer = 0.28; this.meleeEffectKind = 'stone'; }
      if (event.type === 'boulder') { this.meleeEffectTimer = 0.48; this.meleeEffectKind = 'boulder'; }
      this.callbacks.onEvent(event, this.snapshot());
      if (event.type === 'wave-clear') {
        this.paused = true;
        this.pointerAttack = false;
        this.lastAutosaveWave = this.state.wave;
        this.callbacks.onAutosave(this.snapshot());
      }
      if (event.type === 'game-over' && !this.ended) {
        this.ended = true;
        this.paused = true;
        this.callbacks.onGameOver(this.snapshot());
      }
    }
    this.hudTimer += dt;
    this.autosaveTimer += dt;
    if (this.hudTimer >= 0.16) {
      this.hudTimer = 0;
      this.publishSnapshot();
    }
    if (this.autosaveTimer >= 12 || this.state.wave !== this.lastAutosaveWave) {
      this.autosaveTimer = 0;
      this.lastAutosaveWave = this.state.wave;
      this.callbacks.onAutosave(this.snapshot());
    }
  }

  private publishSnapshot(): void {
    if (this.state) this.callbacks.onSnapshot(this.snapshot());
  }

  private clearWorldSprites(): void {
    for (const sprite of this.enemySprites.values()) sprite.destroy();
    this.enemySprites.clear();
    for (const sprite of this.enemyStatusSprites.values()) sprite.destroy();
    this.enemyStatusSprites.clear();
    for (const sprite of this.petSprites.values()) sprite.destroy();
    this.petSprites.clear();
    this.previousPetPositions.clear();
    for (const sprite of this.projectileSprites) sprite.destroy();
    this.projectileSprites.length = 0;
  }

  private renderState(): void {
    if (!this.state || !this.playerSprite) return;
    const state = this.state;
    const time = this.time.now / 1000;
    this.playerSprite.setPosition(state.player.x, state.player.y + (this.moving ? Math.sin(time * 17) * 2.4 : Math.sin(time * 2.3) * 1.1));
    this.playerSprite.setDepth(state.player.y + 20);
    this.playerSprite.setRotation(Math.max(-0.07, Math.min(0.07, state.player.facingX * 0.05)));
    this.playerSprite.setAlpha(state.player.invulnerable > 0 && Math.floor(time * 16) % 2 === 0 ? 0.48 : 1);
    const aimAngle = Math.atan2(state.player.facingY, state.player.facingX);
    this.slingshotSprite?.setPosition(state.player.x + 31, state.player.y - 20)
      .setDisplaySize(20, 27)
      .setRotation(aimAngle + Math.PI / 2)
      .setDepth(state.player.y + 28);
    if (this.stoneSprite) {
      const active = this.meleeEffectTimer > 0;
      const duration = this.meleeEffectKind === 'boulder' ? 0.48 : 0.28;
      const progress = 1 - this.meleeEffectTimer / duration;
      const swing = progress * Math.PI * 1.35 - Math.PI * 0.7;
      const radius = this.meleeEffectKind === 'boulder' ? 56 : 37;
      this.stoneSprite.setVisible(active)
        .setTexture(this.meleeEffectKind === 'boulder' ? 'boulder' : 'large-stone')
        .setDisplaySize(this.meleeEffectKind === 'boulder' ? 48 : 28, this.meleeEffectKind === 'boulder' ? 48 : 28)
        .setPosition(state.player.x + Math.cos(swing) * radius, state.player.y + Math.sin(swing) * radius - 10)
        .setRotation(swing)
        .setDepth(state.player.y + 50);
    }

    const activePetTypes = new Set(state.pets.map((pet) => pet.type));
    for (const [type, sprite] of this.petSprites) {
      if (!activePetTypes.has(type)) {
        sprite.destroy();
        this.petSprites.delete(type);
        this.previousPetPositions.delete(type);
      }
    }
    state.pets.forEach((pet, index) => {
      const texture = `pet-${pet.type}`;
      let sprite = this.petSprites.get(pet.type);
      if (!sprite) {
        sprite = this.add.image(pet.x, pet.y, texture).setDisplaySize(56, 48).setOrigin(0.5, 0.86);
        this.petSprites.set(pet.type, sprite);
      }
      const previous = this.previousPetPositions.get(pet.type);
      const running = previous !== undefined && Math.hypot(pet.x - previous.x, pet.y - previous.y) > 0.5;
      this.previousPetPositions.set(pet.type, { x: pet.x, y: pet.y });
      const bob = Math.sin(time * (running ? 18 : 3) + index * 2.2) * (running ? 2.5 : 0.8);
      sprite.setPosition(pet.x, pet.y + bob)
        .setFlipX(pet.facingX < -0.15)
        .setRotation(pet.facingY * 0.05)
        .setDepth(pet.y + 14);
    });

    const aliveIds = new Set(state.enemies.map((enemy) => enemy.id));
    for (const [id, sprite] of this.enemySprites) {
      if (!aliveIds.has(id)) {
        sprite.destroy();
        this.enemySprites.delete(id);
        this.enemyStatusSprites.get(id)?.destroy();
        this.enemyStatusSprites.delete(id);
      }
    }
    for (const enemy of state.enemies) {
      let sprite = this.enemySprites.get(enemy.id);
      if (!sprite) {
        const key = SPRITES[enemy.kind];
        sprite = this.add.image(enemy.x, enemy.y, key).setOrigin(0.5, 0.7).setDepth(enemy.y + 10);
        this.enemySprites.set(enemy.id, sprite);
      }
      const bob = enemy.kind === 'crow' ? Math.sin(time * 7 + enemy.id) * 7 : Math.sin(time * 10 + enemy.id) * 1.5;
      sprite.setPosition(enemy.x, enemy.y + bob);
      sprite.setDepth(enemy.y + 12);
      sprite.setAlpha(enemy.kind === 'mole' && enemy.mood === 'burrow' ? 0.12 : 1);
      sprite.setScale(enemy.kind === 'kingBoar' ? 0.85 : enemy.kind === 'boar' ? 0.61 : 0.55);
      if (enemy.hitFlash > 0) sprite.setTint(0xffeee0);
      else sprite.clearTint();
      sprite.setRotation(enemy.kind === 'crow' ? Math.sin(time * 4 + enemy.id) * 0.05 : 0);
      let statusSprite = this.enemyStatusSprites.get(enemy.id);
      if (!statusSprite) {
        statusSprite = this.add.text(enemy.x, enemy.y - 46, '', { fontFamily: 'sans-serif', fontSize: '16px', color: '#fff8df', stroke: '#4a473c', strokeThickness: 3 })
          .setOrigin(0.5).setDepth(enemy.y + 60).setVisible(false);
        this.enemyStatusSprites.set(enemy.id, statusSprite);
      }
      if (enemy.status && (enemy.statusTimer ?? 0) > 0) {
        const icon = enemy.status === 'knockback' ? '💨' : enemy.status === 'groggy' ? '💫' : '⭐';
        statusSprite.setText(icon).setPosition(enemy.x, enemy.y - 43).setDepth(enemy.y + 60).setVisible(true);
      } else statusSprite.setVisible(false);
    }

    while (this.projectileSprites.length < state.projectiles.length) {
      this.projectileSprites.push(this.add.image(0, 0, 'bb-pellet').setDepth(700));
    }
    while (this.projectileSprites.length > state.projectiles.length) this.projectileSprites.pop()?.destroy();
    state.projectiles.forEach((projectile, index) => {
      const sprite = this.projectileSprites[index];
      const type = projectile.ammo ?? 'bb';
      const texture = type === 'steelBb' ? 'steel-bb-pellet' : type === 'stone' ? 'stone-pellet' : 'bb-pellet';
      const size = type === 'stone' ? 16 : type === 'steelBb' ? 11 : 9;
      sprite?.setTexture(texture).setDisplaySize(size, size).setPosition(projectile.x, projectile.y).setRotation(Math.atan2(projectile.vy, projectile.vx));
    });

    const graphics = this.bars;
    if (!graphics) return;
    graphics.clear();
    const drawFarmBar = (x: number, y: number, width: number, hp: number, maxHp: number, color: number): void => {
      graphics.fillStyle(0x334434, 0.7).fillRoundedRect(x - width / 2 - 1, y - 1, width + 2, 5, 2);
      if (hp > 0) graphics.fillStyle(color, 0.94).fillRoundedRect(x - width / 2, y, width * Math.max(0, hp / maxHp), 3, 1);
    };
    CROP_TARGETS.forEach((crop, index) => drawFarmBar(crop.x, crop.y + 33, 34, state.farm.crops[index].hp, state.farm.crops[index].maxHp, 0x9dbe6e));
    const facilityBars = [{ id: 'barn', x: 190, y: 108 }, { id: 'coop', x: 825, y: 125 }, { id: 'silo', x: 870, y: 411 }];
    for (const target of facilityBars) {
      const facility = state.farm.facilities[target.id];
      drawFarmBar(target.x, target.y, 45, facility.hp, facility.maxHp, 0xdab866);
    }
    for (const enemy of state.enemies) {
      const boss = enemy.kind === 'kingBoar';
      const width = boss ? 62 : 36;
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      const x = enemy.x - width / 2;
      const y = enemy.y - (boss ? 58 : 39);
      graphics.fillStyle(0x26362c, 0.76).fillRoundedRect(x - 1, y - 1, width + 2, 6, 3);
      graphics.fillStyle(boss ? 0xe7674f : 0xf2cd73, 1).fillRoundedRect(x, y, width * ratio, 4, 2);
    }
  }
}
