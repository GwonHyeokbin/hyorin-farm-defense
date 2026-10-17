export type GrowthStage = 1 | 2 | 3 | 4;

export const GROWTH_STAGES: Record<GrowthStage, { label: string; spriteName: string }> = {
  1: { label: '아기 효린', spriteName: '아기' },
  2: { label: '어린이 효린', spriteName: '어린이' },
  3: { label: '청소년 효린', spriteName: '청소년' },
  4: { label: '성인 효린', spriteName: '성인' },
};

/** Convert remaining health into the matching Defense 2 age sprite. */
export function growthStageForHealth(hp: number, maxHp: number): GrowthStage {
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}
