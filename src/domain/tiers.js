export const STAR_LEVELS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// EA's own mapping of team overall → star rating (EA does not publish it; this is the table the community guides give for FC 25
// and FC 26, checked against club data: Leverkusen 83 = 5★, Newcastle 81 and Man United 80 = 4.5★, Brighton 77 = 4★).
// It is only the starting point: /config edits the stored tiers, and "Reset to EA table" restores these.
export const DEFAULT_TIERS = [
  { stars: 5, minOvr: 83 },
  { stars: 4.5, minOvr: 79 },
  { stars: 4, minOvr: 75 },
  { stars: 3.5, minOvr: 71 },
  { stars: 3, minOvr: 69 },
  { stars: 2.5, minOvr: 67 },
  { stars: 2, minOvr: 65 },
  { stars: 1.5, minOvr: 63 },
  { stars: 1, minOvr: 60 },
  { stars: 0.5, minOvr: 0 },
];

export function starsForOvr(ovr, tiers = DEFAULT_TIERS) {
  const sorted = [...tiers].sort((a, b) => b.minOvr - a.minOvr);
  for (const tier of sorted) if (ovr >= tier.minOvr) return tier.stars;
  return sorted.at(-1).stars;
}
