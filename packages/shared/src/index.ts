/** Bottle sizes in millilitres. 750 ml is the default everywhere. */
export const BOTTLE_SIZES_ML = {
  half: 375,
  standard: 750,
  magnum: 1500,
  doubleMagnum: 3000,
} as const;

export const DEFAULT_BOTTLE_SIZE_ML = BOTTLE_SIZES_ML.standard;
