import type { GameState } from './types';
import { normalizeGameState } from './save-code';

const AUTOSAVE_KEY = 'hyorin-farm-defense.autosave.v1';
const RECORDS_KEY = 'hyorin-farm-defense.records.v1';
const SETTINGS_KEY = 'hyorin-farm-defense.settings.v1';

export interface GameRecord {
  score: number;
  wave: number;
  kills: number;
  protectedCrops: number;
  playedAt: number;
  seconds: number;
}

export interface GameSettings {
  sound: boolean;
  music: boolean;
  soundVolume: number;
  musicVolume: number;
}

export function saveAutosave(state: GameState): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearAutosave(): void {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* Private browsing may disable storage. */ }
}

export function loadAutosave(): GameState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? 'null');
    return normalizeGameState(value);
  } catch {
    return null;
  }
}

export function saveRecord(record: GameRecord): void {
  try {
    const previous = loadRecords();
    localStorage.setItem(RECORDS_KEY, JSON.stringify([record, ...previous].slice(0, 12)));
  } catch {
    // 저장 공간이 없어도 플레이 결과 화면은 계속 보여준다.
  }
}

export function loadRecords(): GameRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is GameRecord => typeof entry === 'object' && entry !== null
      && Number.isFinite(entry.score) && Number.isFinite(entry.wave) && Number.isFinite(entry.playedAt));
  } catch {
    return [];
  }
}

export function clearRecords(): void {
  try { localStorage.removeItem(RECORDS_KEY); } catch { /* Private browsing may disable storage. */ }
}

export function getSettings(): GameSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<GameSettings>;
    return {
      sound: value.sound !== false,
      music: value.music !== false,
      soundVolume: Number.isFinite(value.soundVolume) ? Math.max(0, Math.min(1, value.soundVolume!)) : 0.75,
      musicVolume: Number.isFinite(value.musicVolume) ? Math.max(0, Math.min(1, value.musicVolume!)) : 0.35,
    };
  } catch {
    return { sound: true, music: true, soundVolume: 0.75, musicVolume: 0.35 };
  }
}

export function setSettings(settings: GameSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Game remains playable without settings storage. */ }
}

export function highestScore(records = loadRecords()): number {
  return records.reduce((highest, record) => Math.max(highest, record.score), 0);
}
