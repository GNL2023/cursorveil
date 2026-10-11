import type { ForgeSettings, PaletteId, Rgba } from "@/lib/cursor/types";

const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

type RGB = [number, number, number];

const RAMPS: Record<Exclude<PaletteId, "source">, RGB[]> = {
  glass: [
    [7, 12, 16],
    [24, 58, 70],
    [86, 158, 172],
    [186, 232, 240],
    [248, 253, 255],
  ],
  mono: [
    [10, 12, 14],
    [62, 70, 76],
    [148, 158, 166],
    [232, 238, 242],
  ],
  silver: [
    [14, 14, 16],
    [78, 82, 88],
    [168, 174, 180],
    [238, 240, 242],
  ],
  mage: [
    [22, 6, 14],
    [104, 18, 42],
    [124, 36, 156],
    [28, 168, 162],
    [214, 252, 255],
  ],
  bronze: [
    [28, 16, 8],
    [86, 52, 24],
    [158, 102, 42],
    [214, 170, 92],
    [244, 226, 190],
  ],
};

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clone(img: Rgba): Rgba {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function downsample(src: Rgba, dw: number, dh: number): Rgba {
  const sw = src.width;
  const sh = src.height;
  const out = new Uint8ClampedArray(dw * dh * 4);
  const s = src.data;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * sw + xx) * 4;
          const aa = s[i + 3] / 255;
          r += s[i] * aa;
          g += s[i + 1] * aa;
          b += s[i + 2] * aa;
          a += aa;
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      if (n === 0 || a < 0.001) continue;
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return { width: dw, height: dh, data: out };
}

function lumaOf(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function grade(c: number, contrast: number, brightness: number) {
  const v = (c / 255 - 0.5) * contrast + 0.5 + brightness;
  return clamp(v, 0, 1) * 255;
}

function hash(x: number, y: number, f: number) {
  let n = (x * 374761393 + y * 668265263 + f * 1442695041) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function buildRamp(id: Exclude<PaletteId, "source">, levels: number): RGB[] {
  const pal = RAMPS[id];
  const ramp: RGB[] = [];
  for (let i = 0; i < levels; i++) {
    const t = levels === 1 ? 0 : i / (levels - 1);
    const x = t * (pal.length - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(pal.length - 1, i0 + 1);
    const f = x - i0;
    ramp.push([
      Math.round(pal[i0][0] + (pal[i1][0] - pal[i0][0]) * f),
      Math.round(pal[i0][1] + (pal[i1][1] - pal[i0][1]) * f),
      Math.round(pal[i0][2] + (pal[i1][2] - pal[i0][2]) * f),
    ]);
  }
  return ramp;
}

function snapIndex(value01: number, levels: number, thresh: number) {
  const scaled = clamp(value01, 0, 0.999999) * (levels - 1);
  let i = Math.floor(scaled);
  if (scaled - i > thresh) i++;
  return clamp(i, 0, levels - 1);
}

function addGlow(img: Rgba, amount: number) {
  if (amount <= 0.01) return;
  const w = img.width;
  const h = img.height;
  const src = img.data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3] / 255;
    const y = lumaOf(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
    lum[i] = y * y * a;
  }
  const tmp = new Float32Array(w * h);
  const blur = new Float32Array(w * h);
  const rad = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -rad; k <= rad; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        s += lum[y * w + xx];
        n++;
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      let n = 0;
      for (let k = -rad; k <= rad; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        s += tmp[yy * w + x];
        n++;
      }
      blur[y * w + x] = s / n;
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (src[i * 4 + 3] === 0) continue;
    const add = blur[i] * amount * 170;
    src[i * 4] = Math.min(255, src[i * 4] + add * 0.72);
    src[i * 4 + 1] = Math.min(255, src[i * 4 + 1] + add * 0.94);
    src[i * 4 + 2] = Math.min(255, src[i * 4 + 2] + add);
  }
}

function chromaShift(img: Rgba, px: number) {
  const shift = Math.round(px);
  if (shift <= 0) return;
  const w = img.width;
  const h = img.height;
  const src = new Uint8ClampedArray(img.data);
  const dst = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const xl = Math.min(w - 1, Math.max(0, x - shift));
      const xr = Math.min(w - 1, Math.max(0, x + shift));
      const il = (y * w + xl) * 4;
      const ir = (y * w + xr) * 4;
      dst[o] = src[il];
      dst[o + 1] = src[o + 1];
      dst[o + 2] = src[ir + 2];
      dst[o + 3] = src[o + 3];
    }
  }
}

function prepare(base: Rgba, settings: ForgeSettings, frame: number, count: number): Rgba {
  const out = clone(base);
  const w = out.width;
  const h = out.height;
  const d = out.data;
  const amt = settings.motionAmt;
  let bright = settings.brightness;
  let chroma = settings.chroma;
  if (settings.motion === "breath" && count > 1) {
    const s = Math.sin((frame / count) * Math.PI * 2);
    bright += s * 0.2 * amt;
    chroma = settings.chroma * (1 + s * 0.85 * amt);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (d[o + 3] < 8) continue;
      let r = grade(d[o], settings.contrast, bright);
      let g = grade(d[o + 1], settings.contrast, bright);
      let b = grade(d[o + 2], settings.contrast, bright);
      if ((settings.motion === "noise" || settings.motion === "orb") && amt > 0) {
        const wob =
          Math.sin(x * 0.73 + y * 0.41 + frame * 1.37) * amt * (settings.motion === "noise" ? 70 : 42);
        r = clamp(r + wob, 0, 255);
        g = clamp(g + wob, 0, 255);
        b = clamp(b + wob, 0, 255);
      }
      if (settings.motion === "flicker" && hash(x, y, frame) < amt * 0.28) {
        r *= 0.45;
        g *= 0.45;
        b *= 0.45;
      }
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
    }
  }
  if (settings.motion === "scan" && amt > 0) {
    const src = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) {
      const shift = Math.round(Math.sin(y * 0.65 + frame * 0.95) * amt * 2.4);
      for (let x = 0; x < w; x++) {
        const from = clamp(x - shift, 0, w - 1);
        const o = (y * w + x) * 4;
        const i = (y * w + from) * 4;
        d[o] = src[i];
        d[o + 1] = src[i + 1];
        d[o + 2] = src[i + 2];
        d[o + 3] = src[i + 3];
      }
    }
  }
  chromaShift(out, chroma);
  addGlow(out, settings.glow);
  return out;
}

function bayerThresh(x: number, y: number, frame: number, settings: ForgeSettings) {
  let ox = 0;
  let oy = 0;
  if (settings.motion === "orb") {
    ox = Math.round(frame * (1 + settings.motionAmt * 4));
    oy = Math.round(frame * (1 + settings.motionAmt * 2));
  }
  return (BAYER[(y + oy) & 7][(x + ox) & 7] + 0.5) / 64;
}

function ditherOrdered(img: Rgba, settings: ForgeSettings, frame: number): Rgba {
  const w = img.width;
  const h = img.height;
  const src = img.data;
  const out = new Uint8ClampedArray(w * h * 4);
  const levels = settings.levels;
  const ramp = settings.palette === "source" ? null : buildRamp(settings.palette, levels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a0 = src[o + 3];
      if (a0 < 8) continue;
      const thresh = bayerThresh(x, y, frame, settings);
      const aIdx = snapIndex(a0 / 255, 4, thresh);
      out[o + 3] = Math.round((aIdx / 3) * 255);
      if (ramp) {
        const idx = snapIndex(lumaOf(src[o], src[o + 1], src[o + 2]), levels, thresh);
        const c = ramp[idx];
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
      } else {
        out[o] = Math.round((snapIndex(src[o] / 255, levels, thresh) / (levels - 1)) * 255);
        out[o + 1] = Math.round((snapIndex(src[o + 1] / 255, levels, thresh) / (levels - 1)) * 255);
        out[o + 2] = Math.round((snapIndex(src[o + 2] / 255, levels, thresh) / (levels - 1)) * 255);
      }
    }
  }
  return { width: w, height: h, data: out };
}

function spread(
  buf: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  er: number,
  eg: number,
  eb: number,
  k: number,
) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 3;
  buf[i] += er * k;
  buf[i + 1] += eg * k;
  buf[i + 2] += eb * k;
}

function ditherDiffusion(img: Rgba, settings: ForgeSettings, kind: "floyd" | "atkinson"): Rgba {
  const w = img.width;
  const h = img.height;
  const src = img.data;
  const buf = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = src[i * 4];
    buf[i * 3 + 1] = src[i * 4 + 1];
    buf[i * 3 + 2] = src[i * 4 + 2];
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const levels = settings.levels;
  const ramp = settings.palette === "source" ? null : buildRamp(settings.palette, levels);
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let xi = 0; xi < w; xi++) {
      const x = ltr ? xi : w - 1 - xi;
      const dir = ltr ? 1 : -1;
      const o = (y * w + x) * 4;
      const a0 = src[o + 3];
      if (a0 < 8) continue;
      const i = (y * w + x) * 3;
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const thresh = (BAYER[y & 7][x & 7] + 0.5) / 64;
      let nr: number;
      let ng: number;
      let nb: number;
      if (ramp) {
        const idx = snapIndex(lumaOf(r, g, b), levels, 0.5);
        nr = ramp[idx][0];
        ng = ramp[idx][1];
        nb = ramp[idx][2];
      } else {
        nr = (snapIndex(r / 255, levels, 0.5) / (levels - 1)) * 255;
        ng = (snapIndex(g / 255, levels, 0.5) / (levels - 1)) * 255;
        nb = (snapIndex(b / 255, levels, 0.5) / (levels - 1)) * 255;
      }
      const aIdx = snapIndex(a0 / 255, 4, thresh);
      out[o] = clamp(Math.round(nr), 0, 255);
      out[o + 1] = clamp(Math.round(ng), 0, 255);
      out[o + 2] = clamp(Math.round(nb), 0, 255);
      out[o + 3] = Math.round((aIdx / 3) * 255);
      const er = r - nr;
      const eg = g - ng;
      const eb = b - nb;
      if (kind === "floyd") {
        spread(buf, w, h, x + dir, y, er, eg, eb, 7 / 16);
        spread(buf, w, h, x - dir, y + 1, er, eg, eb, 3 / 16);
        spread(buf, w, h, x, y + 1, er, eg, eb, 5 / 16);
        spread(buf, w, h, x + dir, y + 1, er, eg, eb, 1 / 16);
      } else {
        const k = 1 / 8;
        spread(buf, w, h, x + dir, y, er, eg, eb, k);
        spread(buf, w, h, x + dir * 2, y, er, eg, eb, k);
        spread(buf, w, h, x - dir, y + 1, er, eg, eb, k);
        spread(buf, w, h, x, y + 1, er, eg, eb, k);
        spread(buf, w, h, x + dir, y + 1, er, eg, eb, k);
        spread(buf, w, h, x, y + 2, er, eg, eb, k);
      }
    }
  }
  return { width: w, height: h, data: out };
}

function nearest(src: Rgba, dw: number, dh: number): Rgba {
  if (src.width === dw && src.height === dh) return src;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / dw));
      const o = (y * dw + x) * 4;
      const i = (sy * src.width + sx) * 4;
      out[o] = src.data[i];
      out[o + 1] = src.data[i + 1];
      out[o + 2] = src.data[i + 2];
      out[o + 3] = src.data[i + 3];
    }
  }
  return { width: dw, height: dh, data: out };
}

export function gridSize(settings: ForgeSettings) {
  return Math.max(8, Math.round(settings.size / settings.pixel));
}

export function outputHotspot(hx: number, hy: number, srcW: number, srcH: number, settings: ForgeSettings) {
  const grid = gridSize(settings);
  const gx = Math.min(grid - 1, Math.max(0, Math.round((hx / Math.max(1, srcW - 1)) * (grid - 1))));
  const gy = Math.min(grid - 1, Math.max(0, Math.round((hy / Math.max(1, srcH - 1)) * (grid - 1))));
  const px = settings.size / grid;
  return {
    x: Math.min(settings.size - 1, Math.max(0, Math.round(gx * px))),
    y: Math.min(settings.size - 1, Math.max(0, Math.round(gy * px))),
  };
}

export function renderClean(sources: Rgba[], size: number, frameIndex: number): Rgba {
  const src = sources[Math.min(sources.length - 1, Math.max(0, frameIndex % sources.length))];
  return downsample(src, size, size);
}

export function renderFrames(sources: Rgba[], settings: ForgeSettings): Rgba[] {
  if (!sources.length) return [];
  const grid = gridSize(settings);
  const fitted = sources.map((s) => downsample(s, grid, grid));
  const generated = settings.motion === "still" ? 1 : Math.max(2, Math.round(settings.frames));
  const count = fitted.length > 1 ? Math.max(generated, fitted.length) : generated;
  const frames: Rgba[] = [];
  for (let f = 0; f < count; f++) {
    const base = fitted[f % fitted.length];
    const prepped = prepare(base, settings, f, count);
    const dithered =
      settings.algo === "bayer" ? ditherOrdered(prepped, settings, f) : ditherDiffusion(prepped, settings, settings.algo);
    frames.push(nearest(dithered, settings.size, settings.size));
  }
  return frames;
}

export function autoHotspot(frame: Rgba): { x: number; y: number } {
  const { width: w, height: h, data } = frame;
  const solid = (x: number, y: number) => data[(y * w + x) * 4 + 3] >= 160;
  const seen = new Uint8Array(w * h);
  const labels = new Int16Array(w * h);
  let bestCount = 0;
  let bestId = 0;
  let nextId = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (seen[start] || !solid(x, y)) continue;
      nextId++;
      const stack = [start];
      seen[start] = 1;
      let count = 0;
      while (stack.length) {
        const i = stack.pop() as number;
        labels[i] = nextId;
        count++;
        const cx = i % w;
        const cy = (i - cx) / w;
        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (seen[ni] || !solid(nx, ny)) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      if (count > bestCount) {
        bestCount = count;
        bestId = nextId;
      }
    }
  }
  let bestX = 0;
  let bestY = 0;
  let best = Infinity;
  let found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] !== bestId) continue;
      const score = y * 4 + x;
      if (score < best) {
        best = score;
        bestX = x;
        bestY = y;
        found = true;
      }
    }
  }
  return found ? { x: bestX, y: bestY } : { x: 0, y: 0 };
}

export function bitmapToRgba(bmp: ImageBitmap): Rgba {
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas ontbreekt");
  ctx.drawImage(bmp, 0, 0);
  const image = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { width: image.width, height: image.height, data: image.data };
}
