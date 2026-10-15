import type { GameSettings } from './storage';

type NoteEvent = 'fire' | 'melee' | 'boulder' | 'level-up' | 'hit' | 'kill' | 'farm-hit' | 'player-hit' | 'wave-start' | 'wave-clear' | 'game-over';

export class AudioKit {
  private context: AudioContext | null = null;
  private settings: GameSettings;
  private musicTimer: number | null = null;
  private noteIndex = 0;

  constructor(settings: GameSettings) {
    this.settings = settings;
  }

  unlock(): void {
    this.getContext();
  }

  setSettings(settings: GameSettings): void {
    this.settings = settings;
    if (!settings.music) this.stopMusic();
    else if (this.musicTimer === null) this.startMusic();
  }

  private getContext(): AudioContext | null {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
      return this.context;
    } catch {
      return null;
    }
  }

  play(event: NoteEvent): void {
    if (!this.settings.sound) return;
    const notes: Record<NoteEvent, [number, number, OscillatorType, number]> = {
      fire: [420, 0.055, 'square', 0.025],
      melee: [240, 0.09, 'triangle', 0.035],
      boulder: [105, 0.2, 'triangle', 0.05],
      'level-up': [784, 0.2, 'triangle', 0.045],
      hit: [190, 0.075, 'triangle', 0.035],
      kill: [700, 0.13, 'triangle', 0.05],
      'farm-hit': [120, 0.16, 'sawtooth', 0.028],
      'player-hit': [145, 0.22, 'square', 0.035],
      'wave-start': [392, 0.34, 'triangle', 0.05],
      'wave-clear': [660, 0.42, 'triangle', 0.045],
      'game-over': [95, 0.48, 'triangle', 0.045],
    };
    const [frequency, duration, type, volume] = notes[event];
    this.tone(frequency, duration, type, volume * this.settings.soundVolume);
    if (event === 'level-up') window.setTimeout(() => this.tone(988, 0.2, 'triangle', 0.04 * this.settings.soundVolume), 110);
    if (event === 'wave-clear') window.setTimeout(() => this.tone(880, 0.32, 'triangle', 0.038 * this.settings.soundVolume), 145);
  }

  startMusic(): void {
    if (!this.settings.music || this.musicTimer !== null) return;
    this.getContext();
    const notes = [196, 246.94, 293.66, 246.94, 220, 261.63, 329.63, 261.63];
    this.musicTimer = window.setInterval(() => {
      if (!this.settings.music) return;
      this.tone(notes[this.noteIndex % notes.length], 0.22, 'triangle', 0.012 * this.settings.musicVolume);
      this.noteIndex += 1;
    }, 620);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number): void {
    const context = this.getContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}
