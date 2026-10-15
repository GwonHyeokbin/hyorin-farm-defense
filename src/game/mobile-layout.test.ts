import { describe, expect, it } from 'vitest';
import { requestLandscapeLock, shouldCollapseLandscapeAmmoPanel, shouldUseTouchLayout, toggleFullscreen } from './mobile-layout';

describe('shouldUseTouchLayout', () => {
  it('enables touch controls for a normal phone viewport', () => {
    expect(shouldUseTouchLayout({
      viewportWidth: 390,
      screenWidth: 390,
      screenHeight: 844,
      maxTouchPoints: 5,
      coarsePointer: true,
    })).toBe(true);
  });

  it('recognizes a phone when the browser requests a desktop-width viewport', () => {
    expect(shouldUseTouchLayout({
      viewportWidth: 980,
      screenWidth: 390,
      screenHeight: 844,
      maxTouchPoints: 5,
      coarsePointer: false,
    })).toBe(true);
  });

  it('recognizes an embedded mobile browser with a desktop-sized CSS viewport', () => {
    expect(shouldUseTouchLayout({
      viewportWidth: 980,
      screenWidth: 980,
      screenHeight: 844,
      maxTouchPoints: 0,
      coarsePointer: false,
      mobileUserAgent: true,
    })).toBe(true);
  });

  it('keeps the desktop layout for a large mouse-only screen', () => {
    expect(shouldUseTouchLayout({
      viewportWidth: 1440,
      screenWidth: 1440,
      screenHeight: 900,
      maxTouchPoints: 0,
      coarsePointer: false,
    })).toBe(false);
  });

  it('uses a collapsible ammo panel for a narrow landscape phone', () => {
    expect(shouldCollapseLandscapeAmmoPanel({ landscape: true, viewportWidth: 667, screenWidth: 844 })).toBe(true);
  });

  it('keeps the separate side panel on a wider landscape screen', () => {
    expect(shouldCollapseLandscapeAmmoPanel({ landscape: true, viewportWidth: 844, screenWidth: 844 })).toBe(false);
    expect(shouldCollapseLandscapeAmmoPanel({ landscape: true, viewportWidth: 1024, screenWidth: 1180 })).toBe(false);
  });
});

describe('screen mode requests', () => {
  it('reports unsupported when landscape locking is unavailable', async () => {
    expect(await requestLandscapeLock(undefined)).toBe('unsupported');
  });

  it('reports a rejected landscape lock honestly', async () => {
    const orientation = { lock: async () => { throw new Error('blocked'); } } as unknown as ScreenOrientation;
    expect(await requestLandscapeLock(orientation)).toBe('failed');
  });

  it('requests the landscape orientation when the API is available', async () => {
    let requested: string | undefined;
    const orientation = { lock: async (value: string) => { requested = value; } } as unknown as ScreenOrientation;
    expect(await requestLandscapeLock(orientation)).toBe('success');
    expect(requested).toBe('landscape');
  });

  it('reports unsupported fullscreen when the browser does not expose the API', async () => {
    const documentRef = { fullscreenEnabled: false, fullscreenElement: null } as unknown as Document;
    expect(await toggleFullscreen({} as HTMLElement, documentRef)).toBe('unsupported');
  });

  it('enters fullscreen only through the element API', async () => {
    let entered = false;
    const element = { requestFullscreen: async () => { entered = true; } } as unknown as HTMLElement;
    const documentRef = { fullscreenEnabled: true, fullscreenElement: null } as unknown as Document;
    expect(await toggleFullscreen(element, documentRef)).toBe('success');
    expect(entered).toBe(true);
  });
});
