import Phaser from 'phaser';
import { FarmScene } from './game/FarmScene';
import type { FarmSceneCallbacks } from './game/FarmScene';
import { createGameState, restoreSafeCheckpoint } from './game/engine';
import { createSaveCode, restoreSaveCode, SaveCodeError, isValidGameState } from './game/save-code';
import { AudioKit } from './game/AudioKit';
import { clearAutosave, clearRecords, getSettings, highestScore, loadAutosave, loadRecords, saveAutosave, saveRecord, setSettings } from './game/storage';
import type { GameSettings } from './game/storage';
import { BOULDER_UPGRADE_COST, UPGRADE_DEFINITIONS, upgradeCost } from './game/upgrades';
import { AMMO_DEFINITIONS, isAmmoType } from './game/ammo';
import { PET_DEFINITIONS, isPetType } from './game/pets';
import type { EngineEvent, GameState, PetType, UpgradeKey } from './game/types';

type View = 'home' | 'game' | 'pause' | 'intermission' | 'gameover';

const dateLabel = (value: number): string => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(value);
const playTime = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}분 ${String(whole % 60).padStart(2, '0')}초`;
};
const safeState = (state: GameState): GameState => structuredClone(state);

export class GameApp {
  private readonly root: HTMLElement;
  private readonly settings: GameSettings;
  private readonly audio: AudioKit;
  private readonly scene: FarmScene;
  private sceneReady = false;
  private pendingStart: GameState | null | undefined;
  private currentView: View = 'home';
  private activeState: GameState | null = null;
  private modalReturn: View = 'home';
  private toastTimer = 0;
  private modalAnnouncement = '';

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = getSettings();
    this.audio = new AudioKit(this.settings);
    const callbacks: FarmSceneCallbacks = {
      onSnapshot: (state) => this.updateHud(state),
      onAutosave: (state) => this.saveProgress(state),
      onEvent: (event, state) => this.handleEvent(event, state),
      onGameOver: (state) => this.handleGameOver(state),
      onPause: (state) => this.handlePause(state),
      onReady: () => this.handleSceneReady(),
    };
    this.scene = new FarmScene(callbacks);
    this.root.innerHTML = this.shellMarkup();
    new Phaser.Game({
      type: Phaser.AUTO,
      width: 1024,
      height: 640,
      parent: 'phaser-container',
      backgroundColor: '#9bb77d',
      render: { antialias: false, roundPixels: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 1024, height: 640 },
      input: { activePointers: 3 },
      scene: [this.scene],
    });
    this.bindEvents();
    this.updateHome();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', () => {
      if (this.activeState && this.activeState.farm.health > 0 && this.activeState.player.hp > 0) saveAutosave(this.scene.snapshot());
    });
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden && this.currentView === 'game') this.scene.pauseRun();
  };

  private shellMarkup(): string {
    return `
      <div class="app-shell">
        <header class="topbar">
          <a class="brand-lockup" href="#home" aria-label="효린이의 농장 지키기 메인">
            <span class="brand-mark" aria-hidden="true">🌱</span>
            <span><b>뉴스농장 아케이드</b><small>HYORIN'S FARM DEFENSE</small></span>
          </a>
          <div class="top-actions">
            <button class="icon-button" data-action="toggle-sound" aria-label="효과음 켜기/끄기" title="소리 설정"><span id="sound-icon">🔊</span></button>
            <button class="icon-button" data-action="settings" aria-label="설정" title="설정">⚙</button>
          </div>
        </header>

        <main>
          <section id="home-view" class="home-view">
            <div class="home-art" aria-hidden="true"><div class="sun-stamp">오늘도<br>잘 자라라!</div><div class="sprout sprout-one">🌿</div><div class="sprout sprout-two">🍅</div></div>
            <div class="hero-copy">
              <p class="eyebrow"><span class="eyebrow-dot"></span> 따뜻한 농장 · 짜릿한 방어전</p>
              <h1>효린이의<br><em>농장 지키기</em></h1>
              <p class="hero-description">작물을 노리는 침입자들로부터 농장을 지켜 주세요.<br>효린이와 함께 오래 버틸수록 더 큰 보상이 기다려요!</p>
              <div class="home-buttons">
                <button class="primary-button" data-action="new-game"><span>새 게임</span><span aria-hidden="true">→</span></button>
                <button class="secondary-button" id="continue-button" data-action="continue" disabled>이어서 하기 <span class="continue-label">자동 저장 없음</span></button>
                <button class="text-button" data-action="open-import">코드로 이어하기 <span aria-hidden="true">↗</span></button>
              </div>
              <div class="home-link-row">
                <button class="subtle-button" data-action="records">🏆 나의 기록</button>
                <button class="subtle-button" data-action="instructions">🖱 조작 방법</button>
                <button class="subtle-button" id="menu-export-button" data-action="menu-export">▣ 코드 만들기</button>
              </div>
            </div>
            <aside class="farm-note"><span class="note-pin">✦</span><b>효린이의 농장 노트</b><p>새총을 쏴<br>침입자로부터 농장을 지켜!</p><span class="note-sign">— 오늘의 작전</span></aside>
            <div class="home-bottom">
              <div class="record-chip"><span class="chip-icon">🏅</span><span>최고 점수</span><b id="home-high-score">0</b></div>
              <div class="record-chip"><span class="chip-icon">🌾</span><span>최고 웨이브</span><b id="home-high-wave">0</b></div>
              <span class="offline-note"><i></i> 브라우저에 저장 · 설치 없이 플레이</span>
            </div>
          </section>

          <section id="game-view" class="game-view" hidden aria-label="게임 플레이">
            <div class="game-statusbar">
              <div class="status-brand"><span>🌱</span><b>농장 방어 중</b></div>
              <div class="status-metrics">
                <div class="metric"><small>점수</small><b id="hud-score">0</b></div>
                <div class="metric"><small>최고 점수</small><b id="hud-best">0</b></div>
                <div class="metric wave-metric"><small>웨이브</small><b id="hud-wave">준비 중</b></div>
                <div class="metric"><small>포인트</small><b id="hud-resources">🍅 0</b></div>
              </div>
              <button class="pause-button" data-action="pause" aria-label="일시정지">Ⅱ</button>
            </div>
            <div class="ammo-toolbar" role="group" aria-label="새총 탄환 선택">
              <span class="ammo-toolbar-title">새총</span>
              ${AMMO_DEFINITIONS.map((ammo, index) => `<button class="ammo-button${index === 0 ? ' is-selected' : ''}" data-ammo="${ammo.type}" aria-pressed="${index === 0}"><span>${ammo.icon}</span><b>${ammo.name}</b><small>${ammo.description}</small></button>`).join('')}
              <span class="secondary-attacks"><b>큰 돌</b> 근접 그로기 <span>·</span> <b>바위 강타</b> <span id="boulder-status">정비 시간에 포인트로 구매</span></span>
            </div>
            <div class="game-stage">
              <div id="phaser-container" class="phaser-container" aria-label="효린이의 농장 게임 화면"></div>
              <div class="stage-top-hud">
                <div class="health-pill"><span>💚 효린</span><div class="health-track"><i id="player-health-bar"></i></div><b id="player-health-text">100 / 100</b></div>
                <div class="health-pill farm-health-pill"><span>🏡 농장</span><div class="health-track"><i id="farm-health-bar"></i></div><b id="farm-health-text">100%</b></div>
              </div>
              <div class="wave-banner" id="wave-banner" aria-live="polite"></div>
              <div class="boss-health" id="boss-health" hidden><span>👑 왕멧돼지</span><div class="health-track"><i id="boss-health-bar"></i></div></div>
              <div class="game-overwash" id="game-overwash" hidden></div>
            </div>
            <div class="game-footer">
              <div class="desktop-hint">마우스 왼쪽 버튼을 누른 채 움직이면 이동하며 가장 가까운 적에게 자동 조준·발사해요 · <kbd>ESC</kbd> 일시정지</div>
              <div class="farm-status-line"><span id="wave-phase-label">침입자를 막아 주세요!</span><span id="player-level-label">Lv.1 · 공격 속도 +0%</span><span id="pet-count-label">펫 0/3</span><span id="kills-label">처치 0</span></div>
            </div>
            <div class="pointer-guide" aria-label="모바일 게임 조작">화면을 누른 채 움직이면 효린이가 따라가며 가장 가까운 적을 자동 공격해요.</div>
          </section>
        </main>
        <footer class="site-footer"><span>효린이의 농장 지키기</span><span>이어서 하기 코드는 가진 사람만 복원할 수 있어요.</span></footer>
        <div id="modal-root" class="modal-root" hidden></div>
      </div>`;
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action], [data-upgrade], [data-copy], [data-ammo], [data-pet]') : null;
      if (!target) return;
      const action = target.dataset.action;
      if (action) this.handleAction(action);
      if (target.dataset.upgrade) this.buyUpgrade(target.dataset.upgrade as UpgradeKey);
      if (target.dataset.copy === 'all') void this.copyCode();
      if (target.dataset.copy === 'chunk') void this.copyChunk(Number(target.dataset.index));
      if (target.dataset.ammo && isAmmoType(target.dataset.ammo) && this.currentView === 'game') this.scene.selectAmmo(target.dataset.ammo);
      if (target.dataset.pet && isPetType(target.dataset.pet)) this.buyPet(target.dataset.pet);
    });
    this.root.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && event.target instanceof HTMLTextAreaElement) event.target.select();
    });
    this.root.addEventListener('input', (event) => {
      const slider = event.target instanceof HTMLInputElement ? event.target : null;
      if (!slider?.dataset.volume) return;
      const key = slider.dataset.volume;
      const value = Math.max(0, Math.min(1, Number(slider.value)));
      if (key === 'sound') this.settings.soundVolume = value;
      else if (key === 'music') this.settings.musicVolume = value;
      this.persistSettings(false);
      this.setText(`#${key}-volume-label`, `${Math.round(value * 100)}%`);
    });
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'new-game': this.startGame(); break;
      case 'continue': this.continueGame(); break;
      case 'pause': if (this.currentView === 'game') this.scene.pauseRun(); break;
      case 'resume': this.modalRoot().hidden = true; this.scene.resumeRun(); this.showView('game'); this.audio.startMusic(); break;
      case 'continue-wave': this.modalRoot().hidden = true; this.scene.continueFromRest(); this.showView('game'); this.audio.startMusic(); break;
      case 'menu': this.confirmMainMenu(); break;
      case 'confirm-menu': this.modalRoot().hidden = true; this.showView('home'); this.audio.stopMusic(); this.updateHome(); break;
      case 'close-modal': this.returnFromModal(); break;
      case 'open-import': this.showImport(); break;
      case 'import-code': this.importCode(); break;
      case 'records': this.showRecords(); break;
      case 'clear-records': this.confirmClearRecords(); break;
      case 'confirm-clear-records': clearRecords(); this.showRecords(); this.updateHome(); break;
      case 'instructions': this.showInstructions(); break;
      case 'settings': if (this.currentView === 'game') this.scene.pauseRun(); this.showSettings(); break;
      case 'close-settings': this.returnFromModal(); break;
      case 'toggle-sound': this.settings.sound = !this.settings.sound; this.persistSettings(); this.updateSoundIcon(); if (this.settings.sound) this.audio.play('wave-start'); break;
      case 'toggle-music': this.settings.music = !this.settings.music; this.persistSettings(); break;
      case 'toggle-sfx': this.settings.sound = !this.settings.sound; this.persistSettings(); break;
      case 'menu-export': this.exportFromHome(); break;
      case 'export-quick': this.exportCurrent('checkpoint'); break;
      case 'export-full': this.exportCurrent('full'); break;
      case 'copy-code': void this.copyCode(); break;
      case 'close-code': this.returnFromModal(); break;
      case 'retry': this.startGame(); break;
      case 'home': this.modalRoot().hidden = true; this.showView('home'); this.audio.stopMusic(); this.updateHome(); break;
      case 'repair': this.repair(); break;
      case 'buy-boulder': this.buyBoulder(); break;
    }
  }

  private handleSceneReady(): void {
    this.sceneReady = true;
    if (this.pendingStart !== undefined) {
      const pending = this.pendingStart;
      this.pendingStart = undefined;
      this.launchRun(pending);
    }
  }

  private startGame(): void {
    this.beginRun(createGameState());
  }

  private continueGame(): void {
    const state = loadAutosave();
    if (!state || !isValidGameState(state) || state.farm.health <= 0 || state.player.hp <= 0) {
      this.showNotice('자동 저장을 불러오지 못했어요. 코드가 있다면 코드로 이어하기를 이용해 주세요.');
      this.updateHome();
      return;
    }
    this.beginRun(state);
  }

  private beginRun(state: GameState | null): void {
    this.audio.unlock();
    this.modalRoot().hidden = true;
    this.pendingStart = state;
    this.showView('game');
    if (this.sceneReady) {
      this.pendingStart = undefined;
      this.launchRun(state);
    }
  }

  private launchRun(state: GameState | null): void {
    const running = this.scene.startRun(state ?? undefined);
    this.activeState = running;
    saveAutosave(running);
    this.updateHud(running);
    this.audio.startMusic();
  }

  private showView(view: View): void {
    this.currentView = view;
    const home = this.root.querySelector<HTMLElement>('#home-view');
    const game = this.root.querySelector<HTMLElement>('#game-view');
    if (home) home.hidden = view !== 'home';
    if (game) game.hidden = view === 'home';
    if (view === 'home') this.root.classList.remove('in-game');
    else this.root.classList.add('in-game');
  }

  private updateHome(): void {
    const records = loadRecords();
    const resume = loadAutosave();
    const usable = resume !== null && isValidGameState(resume) && resume.farm.health > 0 && resume.player.hp > 0;
    const continueButton = this.root.querySelector<HTMLButtonElement>('#continue-button');
    if (continueButton) {
      continueButton.disabled = !usable;
      continueButton.querySelector('.continue-label')!.textContent = usable ? `웨이브 ${resume.wave} · ${resume.score.toLocaleString()}점` : '자동 저장 없음';
    }
    const exportButton = this.root.querySelector<HTMLButtonElement>('#menu-export-button');
    if (exportButton) exportButton.disabled = !usable;
    this.root.querySelector<HTMLElement>('#home-high-score')!.textContent = highestScore(records).toLocaleString();
    this.root.querySelector<HTMLElement>('#home-high-wave')!.textContent = String(Math.max(0, ...records.map((record) => record.wave)));
    this.updateSoundIcon();
  }

  private updateSoundIcon(): void {
    const icon = this.root.querySelector<HTMLElement>('#sound-icon');
    if (icon) icon.textContent = this.settings.sound ? '🔊' : '🔇';
  }

  private updateHud(state: GameState): void {
    this.activeState = state;
    this.setText('#hud-score', state.score.toLocaleString());
    this.setText('#hud-best', Math.max(highestScore(), state.score).toLocaleString());
    this.setText('#hud-wave', state.wave === 0 ? '준비 중' : `WAVE ${String(state.wave).padStart(2, '0')}`);
    this.setText('#hud-resources', `🍅 ${state.resources}`);
    this.setText('#player-level-label', `Lv.${state.level} · 공격 속도 +${state.level - 1}% · EXP ${state.experience}/${state.experienceToNext}`);
    this.setText('#boulder-status', state.boulderUnlocked ? '구매 완료 · 자동 범위 기절' : '정비 시간에 포인트로 구매');
    this.setText('#pet-count-label', `펫 ${state.pets.length}/3`);
    this.root.querySelectorAll<HTMLButtonElement>('[data-ammo]').forEach((button) => {
      const selected = button.dataset.ammo === state.ammo;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const playerRatio = Math.max(0, Math.min(100, state.player.hp / state.player.maxHp * 100));
    const farmRatio = Math.max(0, Math.min(100, state.farm.health / state.farm.maxHealth * 100));
    this.setStyle('#player-health-bar', 'width', `${playerRatio}%`);
    this.setStyle('#farm-health-bar', 'width', `${farmRatio}%`);
    this.setText('#player-health-text', `${Math.ceil(state.player.hp)} / ${state.player.maxHp}`);
    this.setText('#farm-health-text', `${Math.ceil(farmRatio)}%`);
    this.setText('#kills-label', `처치 ${state.stats.kills}`);
    this.setText('#wave-phase-label', state.waveState.phase === 'rest' ? `정비 시간 · 다음 웨이브 준비` : `침입자를 막아 주세요! · ${state.waveState.spawned}/${state.waveState.total}`);
    const boss = state.enemies.find((enemy) => enemy.kind === 'kingBoar');
    const bossBox = this.root.querySelector<HTMLElement>('#boss-health');
    if (bossBox) bossBox.hidden = !boss;
    if (boss) this.setStyle('#boss-health-bar', 'width', `${Math.max(0, boss.hp / boss.maxHp * 100)}%`);
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  private setStyle(selector: string, property: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.style.setProperty(property, value);
  }

  private saveProgress(state: GameState): void {
    this.activeState = state;
    saveAutosave(state);
    this.updateHud(state);
  }

  private handleEvent(event: EngineEvent, state: GameState): void {
    switch (event.type) {
      case 'fire': case 'melee': case 'boulder': case 'level-up': case 'kill': case 'farm-hit': case 'player-hit': case 'wave-start': case 'wave-clear': case 'game-over':
        this.audio.play(event.type);
        break;
    }
    if (event.type === 'level-up') this.showToast(event.text ?? `레벨 ${state.level} 상승! 공격 속도 +1%`);
    if (event.type === 'boulder') this.showToast('바위 강타! 주변 침입자가 기절했어요.');
    if (event.type === 'wave-start') this.showToast(event.text ?? `제${state.wave}웨이브 시작!`);
    if (event.type === 'wave-clear') {
      this.audio.stopMusic();
      saveAutosave(state);
      this.showIntermission(state);
    }
    if (event.type === 'player-hit' || event.type === 'farm-hit') this.root.querySelector('#game-view')?.classList.add('damage-shake');
    window.setTimeout(() => this.root.querySelector('#game-view')?.classList.remove('damage-shake'), 180);
  }

  private handlePause(state: GameState): void {
    this.audio.stopMusic();
    saveAutosave(state);
    this.activeState = state;
    this.showPause();
  }

  private handleGameOver(state: GameState): void {
    this.audio.stopMusic();
    this.activeState = state;
    clearAutosave();
    saveRecord({ score: state.score, wave: state.wave, kills: state.stats.kills, protectedCrops: state.stats.protectedCrops, playedAt: Date.now(), seconds: Math.round(state.elapsed) });
    this.showView('gameover');
    this.updateHud(state);
    const modal = this.modalRoot();
    modal.hidden = false;
    modal.innerHTML = `<section class="modal-card result-card" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <span class="modal-kicker">농장 방어 기록</span><h2 id="result-title">오늘도 수고했어요!</h2><p class="modal-copy">농장을 지키기 위해 정말 열심히 싸웠어요.</p>
      <div class="result-score"><small>최종 점수</small><b>${state.score.toLocaleString()}</b><span>BEST ${highestScore().toLocaleString()}</span></div>
      <div class="result-stats"><div><small>도달 웨이브</small><b>${state.wave}</b></div><div><small>침입자 처치</small><b>${state.stats.kills}</b></div><div><small>작물 방어</small><b>${state.stats.protectedCrops}</b></div><div><small>플레이 시간</small><b>${playTime(state.elapsed)}</b></div></div>
      <div class="modal-actions"><button class="primary-button" data-action="retry">다시 농장 지키기 <span>↻</span></button><button class="secondary-button" data-action="home">메인 메뉴</button><button class="text-button" data-action="export-full">마지막 상태 코드 만들기</button></div>
    </section>`;
    this.focusModal();
  }

  private showIntermission(state: GameState): void {
    this.activeState = state;
    this.showView('intermission');
    this.renderIntermission();
  }

  private renderIntermission(): void {
    const state = this.scene.snapshot();
    this.activeState = state;
    const cards = UPGRADE_DEFINITIONS.map((definition) => {
      const level = state.upgrades[definition.key];
      const cost = upgradeCost(definition.key, level);
      const disabled = level >= 5 || state.resources < cost;
      return `<button class="upgrade-card" data-upgrade="${definition.key}" ${disabled ? 'disabled' : ''}>
        <span class="upgrade-icon">${definition.icon}</span><span class="upgrade-copy"><b>${definition.name}<small>Lv.${level}/5</small></b><small>${definition.description}</small></span><span class="upgrade-price">${level >= 5 ? '최대' : `🍅 ${Math.ceil(cost)}`}</span>
      </button>`;
    }).join('');
    const boulderButton = `<button class="upgrade-card boulder-upgrade-card" data-action="buy-boulder" ${state.boulderUnlocked || state.resources < BOULDER_UPGRADE_COST ? 'disabled' : ''}>
      <span class="upgrade-icon">🪨</span><span class="upgrade-copy"><b>바위 강타 ${state.boulderUnlocked ? '<small>구매 완료</small>' : ''}</b><small>가까운 적 최대 4마리를 기절시켜요. 구매 후 자동으로 발동합니다.</small></span><span class="upgrade-price">${state.boulderUnlocked ? '보유 중' : `🍅 ${BOULDER_UPGRADE_COST} 포인트`}</span>
    </button>`;
    const petCards = PET_DEFINITIONS.map((pet) => {
      const owned = state.pets.some((companion) => companion.type === pet.type);
      const disabled = owned || state.resources < pet.price;
      const image = import.meta.env.BASE_URL + 'art/' + pet.image;
      return `<button class="pet-card" data-pet="${pet.type}" ${disabled ? 'disabled' : ''} aria-label="${pet.name} 펫 구매">
        <img src="${image}" alt="" /><span class="pet-card-copy"><b>${pet.name}</b><small>${pet.description}</small></span><strong>${owned ? '함께 지키는 중' : `🍅 ${pet.price} 포인트`}</strong>
      </button>`;
    }).join('');
    const modal = this.modalRoot();
    modal.hidden = false;
    modal.innerHTML = `<section class="modal-card intermission-card" role="dialog" aria-modal="true" aria-labelledby="intermission-title">
      <div class="rest-stamp">정비 시간</div><span class="modal-kicker">제${state.wave}웨이브 방어 성공</span><h2 id="intermission-title">농장을 정비해요</h2><p class="modal-copy">효린이의 체력과 전투 상태가 완전히 회복됐어요. 다음 침입에 대비해 장비를 강화해 주세요.</p>
      <div class="intermission-summary"><span>이번 웨이브 보상</span><b>+${12 + Math.min(20, state.wave * 2)} 🍅</b><span class="resource-total">보유 포인트 <strong>🍅 ${state.resources}</strong></span></div>
      <div class="upgrade-grid">${cards}${boulderButton}</div>
      <div class="pet-shop"><div class="pet-shop-heading"><b>농장 수호 펫</b><small>구매한 고양이는 순찰하며 침입자를 공격해요.</small></div><div class="pet-shop-grid">${petCards}</div></div>
      <div class="intermission-bottom"><button class="repair-button" data-action="repair" ${state.resources < 20 || state.farm.health >= state.farm.maxHealth ? 'disabled' : ''}>🪵 농장 수리 <small>🍅 20</small></button><button class="primary-button" data-action="continue-wave">다음 웨이브 <span>→</span></button></div>
      <button class="text-button" data-action="export-quick">이어하기 코드 만들기</button>
    </section>`;
    this.focusModal();
  }

  private buyUpgrade(key: UpgradeKey): void {
    if (this.currentView !== 'intermission') return;
    if (this.scene.purchaseUpgrade(key)) this.renderIntermission();
  }

  private repair(): void {
    if (this.currentView === 'intermission' && this.scene.repairRun()) this.renderIntermission();
  }

  private buyBoulder(): void {
    if (this.currentView === 'intermission' && this.scene.purchaseBoulder()) this.renderIntermission();
  }

  private buyPet(type: PetType): void {
    if (this.currentView === 'intermission' && this.scene.purchasePet(type)) this.renderIntermission();
  }

  private showPause(): void {
    this.showView('pause');
    const state = this.activeState ?? this.scene.snapshot();
    const modal = this.modalRoot();
    modal.hidden = false;
    modal.innerHTML = `<section class="modal-card pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <span class="modal-kicker">잠깐 쉬어 가요</span><h2 id="pause-title">게임 일시정지</h2><p class="modal-copy">현재 상태는 이 브라우저에 자동 저장했어요.</p>
      <div class="pause-summary"><span>WAVE <b>${state.wave}</b></span><span>점수 <b>${state.score.toLocaleString()}</b></span><span>포인트 <b>${state.resources}</b></span></div>
      <div class="modal-actions"><button class="primary-button" data-action="resume">계속하기 <span>▶</span></button><button class="secondary-button" data-action="export-quick">간편 이어하기 코드</button><button class="secondary-button" data-action="export-full">전체 상태 백업 코드</button><button class="text-button" data-action="settings">설정</button><button class="text-button danger-text" data-action="menu">메인 메뉴로</button></div>
    </section>`;
    this.focusModal();
  }

  private confirmMainMenu(): void {
    const modal = this.modalRoot();
    modal.innerHTML = `<section class="modal-card small-modal" role="dialog" aria-modal="true" aria-labelledby="menu-confirm-title"><span class="modal-kicker">자동 저장 완료</span><h2 id="menu-confirm-title">메인 메뉴로 갈까요?</h2><p class="modal-copy">지금까지의 상태는 이어서 하기에서 다시 열 수 있어요.</p><div class="modal-actions"><button class="primary-button" data-action="confirm-menu">메인 메뉴로 이동</button><button class="secondary-button" data-action="close-modal">계속 플레이</button></div></section>`;
    modal.hidden = false;
    this.focusModal();
  }

  private showImport(): void {
    this.modalReturn = this.currentView;
    const modal = this.modalRoot();
    modal.hidden = false;
    modal.innerHTML = `<section class="modal-card code-import-card" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <span class="modal-kicker">서버 없이 복원</span><h2 id="import-title">이어하기 코드 입력</h2><p class="modal-copy">코드를 붙여 넣으면 코드 안의 저장 시점 그대로 복원합니다. 대문자와 숫자만 입력해 주세요.</p>
      <label class="field-label" for="resume-code-input">저장 코드</label><textarea id="resume-code-input" class="code-input" rows="4" spellcheck="false" autocomplete="off" autocapitalize="characters" placeholder="예: HFD1…"></textarea>
      <p id="code-error" class="inline-error" aria-live="polite"></p>
      <div class="modal-actions"><button class="primary-button" data-action="import-code">코드 확인하고 이어하기 <span>→</span></button><button class="secondary-button" data-action="close-modal">닫기</button></div>
      <p class="privacy-note">코드에는 점수, 체력, 웨이브 등 저장 상태가 들어 있어요. 코드를 받은 사람은 해당 상태를 복원할 수 있습니다.</p>
    </section>`;
    this.focusModal();
  }

  private async importCode(): Promise<void> {
    const input = this.modalRoot().querySelector<HTMLTextAreaElement>('#resume-code-input');
    const error = this.modalRoot().querySelector<HTMLElement>('#code-error');
    if (!input || !error) return;
    try {
      const restored = await restoreSaveCode(input.value);
      const state = safeState(restored.state);
      this.modalRoot().hidden = true;
      this.beginRun(state);
      this.showToast(`저장 코드를 복원했어요 · ${restored.kind === 'full' ? '전체 상태' : '간편 저장'}`);
    } catch (cause) {
      error.textContent = cause instanceof SaveCodeError ? cause.message : '코드를 읽지 못했어요. 입력을 확인해 주세요.';
      input.setAttribute('aria-invalid', 'true');
    }
  }

  private exportFromHome(): void {
    const state = loadAutosave();
    if (state && isValidGameState(state)) this.showSaveCode(state, 'checkpoint', 'home');
  }

  private exportCurrent(kind: 'checkpoint' | 'full'): void {
    let state = this.scene.snapshot();
    if (!this.activeState && this.currentView === 'home') {
      const saved = loadAutosave();
      if (!saved || !isValidGameState(saved)) { this.showNotice('코드를 만들 저장 상태가 없어요. 먼저 새 게임을 시작해 주세요.'); return; }
      state = saved;
    }
    if (kind === 'checkpoint') state = restoreSafeCheckpoint(state);
    this.showSaveCode(state, kind, this.currentView);
  }

  private showSaveCode(state: GameState, kind: 'checkpoint' | 'full', returnView: View): void {
    this.modalReturn = returnView;
    try {
      const code = createSaveCode(state, kind);
      const chunkSize = 72;
      const chunks = Array.from({ length: Math.ceil(code.length / chunkSize) }, (_, index) => code.slice(index * chunkSize, (index + 1) * chunkSize));
      const chunkMarkup = chunks.length > 1 ? `<div class="code-chunks"><b>복사할 구간 ${chunks.length}개</b>${chunks.map((chunk, index) => `<div class="code-chunk"><span>${index + 1} / ${chunks.length}</span><code>${chunk}</code><button class="mini-button" data-copy="chunk" data-index="${index}">복사</button></div>`).join('')}</div>` : '';
      const modal = this.modalRoot();
      modal.hidden = false;
      modal.innerHTML = `<section class="modal-card code-export-card" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <span class="modal-kicker">${kind === 'full' ? '전체 상태 백업' : '안전 시점 간편 코드'}</span><h2 id="export-title">이어하기 코드를 보관하세요</h2>
        <p class="modal-copy">${kind === 'full' ? '현재 전투 중인 적과 투사체, 구매한 수호 펫까지 포함한 상태예요.' : '웨이브, 점수, 체력, 작물, 업그레이드와 구매한 수호 펫을 저장했어요. 전투 중 적은 저장하지 않는 안전 시점 코드예요.'}</p>
        <textarea id="save-code-output" class="code-output" readonly spellcheck="false" aria-label="생성된 이어하기 코드"></textarea>
        ${chunkMarkup}<p id="copy-status" class="copy-status" aria-live="polite">코드를 가진 사람은 저장 상태를 복원할 수 있어요.</p>
        <div class="modal-actions"><button class="primary-button" data-copy="all">전체 코드 복사 <span>▣</span></button><button class="secondary-button" data-action="close-code">완료</button></div>
        <p class="privacy-note">코드는 서버에 업로드되지 않아요. 안전한 곳에 보관하고, 공유할 때는 저장 데이터가 공개될 수 있음을 확인하세요.</p>
      </section>`;
      modal.querySelector<HTMLTextAreaElement>('#save-code-output')!.value = chunks.join('\n');
      this.modalAnnouncement = chunks.join('');
      this.focusModal();
    } catch (cause) {
      this.showNotice(cause instanceof Error ? cause.message : '저장 코드를 만들지 못했어요.');
    }
  }

  private async copyCode(): Promise<void> {
    const value = this.modalAnnouncement;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.setText('#copy-status', '전체 코드를 클립보드에 복사했어요.');
    } catch {
      const output = this.modalRoot().querySelector<HTMLTextAreaElement>('#save-code-output');
      output?.focus(); output?.select();
      this.setText('#copy-status', '자동 복사할 수 없어 코드 전체를 선택했어요. Ctrl+C로 복사해 주세요.');
    }
  }

  private async copyChunk(index: number): Promise<void> {
    const chunk = this.modalAnnouncement.slice(index * 72, (index + 1) * 72);
    try {
      await navigator.clipboard.writeText(chunk);
      this.setText('#copy-status', `구간 ${index + 1}을 복사했어요. 순서대로 이어 붙여 보관해 주세요.`);
    } catch {
      this.setText('#copy-status', `구간 ${index + 1}: ${chunk}`);
    }
  }

  private returnFromModal(): void {
    this.modalRoot().hidden = true;
    this.modalAnnouncement = '';
    if (this.modalReturn === 'pause') this.showPause();
    else if (this.modalReturn === 'intermission') this.showIntermission(this.scene.snapshot());
    else if (this.modalReturn === 'gameover') this.handleGameOver(this.activeState ?? this.scene.snapshot());
    else if (this.modalReturn === 'game') { this.modalRoot().hidden = true; this.showView('game'); }
    else { this.showView('home'); this.updateHome(); }
  }

  private showRecords(): void {
    this.modalReturn = this.currentView;
    const records = loadRecords();
    const highestWave = Math.max(0, ...records.map((record) => record.wave));
    const rows = records.length ? records.map((record, index) => `<div class="record-row"><span class="record-rank">${String(index + 1).padStart(2, '0')}</span><span class="record-main"><b>${record.score.toLocaleString()}점</b><small>${dateLabel(record.playedAt)} · ${playTime(record.seconds)}</small></span><span class="record-wave">WAVE ${record.wave}<small>처치 ${record.kills}</small></span></div>`).join('') : '<div class="empty-records"><span>🌱</span><b>아직 기록이 없어요</b><small>첫 방어전을 시작해 보세요!</small></div>';
    this.showModal(`<section class="modal-card records-card" role="dialog" aria-modal="true" aria-labelledby="records-title"><span class="modal-kicker">이 브라우저에 저장된 개인 기록</span><h2 id="records-title">나의 농장 기록</h2><div class="record-summary"><div><small>최고 점수</small><b>${highestScore(records).toLocaleString()}</b></div><div><small>최고 웨이브</small><b>${highestWave}</b></div></div><div class="record-list">${rows}</div><div class="modal-actions"><button class="secondary-button" data-action="clear-records" ${records.length ? '' : 'disabled'}>기록 초기화</button><button class="primary-button" data-action="close-modal">닫기</button></div><p class="privacy-note">기록은 현재 브라우저의 저장 공간에만 보관됩니다.</p></section>`);
    this.focusModal();
  }

  private confirmClearRecords(): void {
    this.modalReturn = 'home';
    this.showModal(`<section class="modal-card small-modal" role="dialog" aria-modal="true" aria-labelledby="clear-title"><span class="modal-kicker">개인 기록</span><h2 id="clear-title">기록을 모두 지울까요?</h2><p class="modal-copy">저장된 최고 점수와 최근 플레이 기록을 삭제합니다.</p><div class="modal-actions"><button class="danger-button" data-action="confirm-clear-records">기록 지우기</button><button class="secondary-button" data-action="records">취소</button></div></section>`);
    this.focusModal();
  }

  private showInstructions(): void {
    this.modalReturn = this.currentView;
    this.showModal(`<section class="modal-card instructions-card" role="dialog" aria-modal="true" aria-labelledby="instructions-title"><span class="modal-kicker">플레이 안내</span><h2 id="instructions-title">효린이와 농장 지키기</h2><div class="instruction-list"><div><span>01</span><b>누르고 끌어 이동·공격</b><p>마우스 왼쪽 버튼을 누른 채 움직이면 효린이가 포인터를 따라가며 가장 가까운 적에게 선택한 탄환을 자동 조준해 쏴요. 탄환은 적을 따라가서 맞히기 쉬워요. 모바일은 화면을 누르고 끌어 주세요.</p></div><div><span>02</span><b>탄환과 돌 공격</b><p>BB탄은 빠르고 약해요. 강철 BB탄은 더 빠르고 조금 강하며, 돌맹이는 맞은 적을 밀쳐내요. 큰 돌은 가까운 적을 그로기 상태로 만들어요. 바위 강타는 정비 시간에 포인트로 구매하면 자동으로 범위 기절 공격을 해요.</p></div><div><span>03</span><b>레벨·펫과 정비</b><p>적을 처치해 경험치를 모으면 레벨마다 공격 속도가 1% 빨라져요. 정비 시간에 누니·양이·마루를 포인트로 구매하면 농장을 순찰하며 침입자를 자동 공격해요. 웨이브를 넘으면 효린이 체력과 전투 상태가 회복돼요.</p></div><div><span>04</span><b>저장 코드는 직접 보관</b><p>일시정지 메뉴에서 간편 이어하기 코드나 전체 백업을 만들 수 있어요. 코드는 서버에 저장되지 않아요.</p></div></div><div class="modal-actions"><button class="primary-button" data-action="close-modal">알겠어요</button></div></section>`);
    this.focusModal();
  }

  private showSettings(): void {
    this.modalReturn = this.currentView;
    this.showModal(`<section class="modal-card settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title"><span class="modal-kicker">내 플레이 환경</span><h2 id="settings-title">설정</h2><div class="setting-row"><span><b>효과음</b><small>공격, 피격, 웨이브 알림</small></span><button class="toggle-button ${this.settings.sound ? 'is-on' : ''}" data-action="toggle-sfx" aria-pressed="${this.settings.sound}">${this.settings.sound ? '켜짐' : '꺼짐'}</button></div><label class="volume-row"><span>효과음 크기 <b id="sound-volume-label">${Math.round(this.settings.soundVolume * 100)}%</b></span><input data-volume="sound" aria-label="효과음 크기" type="range" min="0" max="1" step="0.05" value="${this.settings.soundVolume}" /></label><div class="setting-row"><span><b>배경 음악</b><small>직접 만든 잔잔한 8비트 선율</small></span><button class="toggle-button ${this.settings.music ? 'is-on' : ''}" data-action="toggle-music" aria-pressed="${this.settings.music}">${this.settings.music ? '켜짐' : '꺼짐'}</button></div><label class="volume-row"><span>배경 음악 크기 <b id="music-volume-label">${Math.round(this.settings.musicVolume * 100)}%</b></span><input data-volume="music" aria-label="배경 음악 크기" type="range" min="0" max="1" step="0.05" value="${this.settings.musicVolume}" /></label><p class="privacy-note">게임 소리는 첫 사용자 입력 이후에만 재생됩니다.</p><div class="modal-actions"><button class="primary-button" data-action="close-settings">완료</button></div></section>`);
    this.focusModal();
  }

  private persistSettings(render = true): void {
    setSettings(this.settings);
    this.audio.setSettings(this.settings);
    this.updateSoundIcon();
    if (render && (this.currentView !== 'home' || !this.modalRoot().hidden)) this.showSettings();
  }

  private showModal(markup: string): void {
    const modal = this.modalRoot();
    modal.hidden = false;
    modal.innerHTML = markup;
  }

  private showNotice(message: string): void {
    this.modalReturn = this.currentView;
    this.showModal(`<section class="modal-card small-modal" role="alertdialog" aria-modal="true"><span class="modal-kicker">안내</span><h2>확인해 주세요</h2><p class="modal-copy">${this.escapeHtml(message)}</p><div class="modal-actions"><button class="primary-button" data-action="close-modal">닫기</button></div></section>`);
    this.focusModal();
  }

  private showToast(message: string): void {
    const toast = this.root.querySelector<HTMLElement>('#wave-banner');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1800);
  }

  private modalRoot(): HTMLElement {
    return this.root.querySelector<HTMLElement>('#modal-root')!;
  }

  private focusModal(): void {
    window.setTimeout(() => this.modalRoot().querySelector<HTMLElement>('button:not(:disabled), textarea')?.focus(), 0);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
  }
}
