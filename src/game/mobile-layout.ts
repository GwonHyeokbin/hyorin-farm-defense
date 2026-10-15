export interface TouchLayoutSignals {
  viewportWidth: number;
  screenWidth: number;
  screenHeight: number;
  maxTouchPoints: number;
  coarsePointer: boolean;
  mobileUserAgent?: boolean;
}

export interface LandscapeAmmoPanelSignals {
  landscape: boolean;
  viewportWidth: number;
  screenWidth: number;
}

/**
 * Some mobile browsers keep a wide desktop-style CSS viewport even when the
 * physical device is a phone. Use the screen's short edge as a fallback.
 */
export function shouldUseTouchLayout(signals: TouchLayoutSignals): boolean {
  const hasTouchInput = signals.maxTouchPoints > 0 || signals.coarsePointer || signals.mobileUserAgent === true;
  const screenShortEdge = Math.min(signals.screenWidth, signals.screenHeight);
  return hasTouchInput && (signals.viewportWidth <= 760 || screenShortEdge <= 760 || signals.mobileUserAgent === true);
}

export function shouldCollapseLandscapeAmmoPanel(signals: LandscapeAmmoPanelSignals): boolean {
  return signals.landscape && Math.min(signals.viewportWidth, signals.screenWidth) <= 720;
}

export type ScreenActionResult = 'success' | 'unsupported' | 'failed';
type ScreenOrientationWithLock = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> };

export async function requestLandscapeLock(orientation: ScreenOrientationWithLock | undefined): Promise<ScreenActionResult> {
  if (typeof orientation?.lock !== 'function') return 'unsupported';
  try {
    await orientation.lock('landscape');
    return 'success';
  } catch {
    return 'failed';
  }
}

export async function toggleFullscreen(element: HTMLElement, documentRef: Document = document): Promise<ScreenActionResult> {
  try {
    if (documentRef.fullscreenElement) {
      if (typeof documentRef.exitFullscreen !== 'function') return 'unsupported';
      await documentRef.exitFullscreen();
      return 'success';
    }
    if (!documentRef.fullscreenEnabled || typeof element.requestFullscreen !== 'function') return 'unsupported';
    await element.requestFullscreen();
    return 'success';
  } catch {
    return 'failed';
  }
}
