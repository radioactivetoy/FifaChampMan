export const STAR_LEVELS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export const DEFAULT_TIERS = [
  { stars: 5, minOvr: 82 },
  { stars: 4.5, minOvr: 77 },
  { stars: 4, minOvr: 73 },
  { stars: 3.5, minOvr: 70 },
  { stars: 3, minOvr: 67 },
  { stars: 2.5, minOvr: 64 },
  { stars: 2, minOvr: 61 },
  { stars: 1.5, minOvr: 56 },
  { stars: 1, minOvr: 51 },
  { stars: 0.5, minOvr: 0 },
];

export function starsForOvr(ovr, tiers = DEFAULT_TIERS) {
  const sorted = [...tiers].sort((a, b) => b.minOvr - a.minOvr);
  for (const tier of sorted) if (ovr >= tier.minOvr) return tier.stars;
  return sorted.at(-1).stars;
}
