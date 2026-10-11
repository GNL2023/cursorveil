export type Algo = "bayer" | "floyd" | "atkinson";
export type PaletteId = "glass" | "mono" | "silver" | "source" | "mage" | "bronze";
export type Motion = "still" | "orb" | "noise" | "breath" | "scan" | "flicker";

export type ForgeSettings = {
  size: number;
  pixel: number;
  algo: Algo;
  levels: number;
  palette: PaletteId;
  contrast: number;
  brightness: number;
  chroma: number;
  glow: number;
  motion: Motion;
  motionAmt: number;
  frames: number;
  fps: number;
};

export const DEFAULT_SETTINGS: ForgeSettings = {
  size: 64,
  pixel: 1,
  algo: "bayer",
  levels: 4,
  palette: "glass",
  contrast: 1.35,
  brightness: 0.04,
  chroma: 1,
  glow: 0.22,
  motion: "orb",
  motionAmt: 0.72,
  frames: 8,
  fps: 12,
};

export const SIZES = [32, 48, 64, 96, 128] as const;
export const PIXELS = [1, 2, 3, 4] as const;
export const FPS = [8, 12, 15, 24] as const;

export type Rgba = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};
