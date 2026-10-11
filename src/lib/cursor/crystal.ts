import { downsample } from "@/lib/cursor/process";
import type { Rgba } from "@/lib/cursor/types";

/**
 * Builds the alternative cursors out of the source photo itself, so the whole
 * set shares the material of the arrow: rotated shards for the directional
 * cursors, an orbit for wait, and the photo's texture poured into the
 * hand-drawn templates for the rest.
 */

type Shard = { img: Rgba; tipX: number; tipY: number; dir: number; len: number };

const S = 96;

function blank(n = S): Rgba {
  return { width: n, height: n, data: new Uint8ClampedArray(n * n * 4) };
}

function bbox(frames: Rgba[], min = 8) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (f.data[(y * f.width + x) * 4 + 3] < min) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}

/** Trims empty margins and pads to a square so nothing gets stretched later. Frames share one box. */
export function squareFrames(frames: Rgba[], maxSide = 256): Rgba[] {
  const box = bbox(frames);
  if (!box) return frames;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const side = Math.max(bw, bh) + 2;
  const ox = Math.floor((side - bw) / 2);
  const oy = Math.floor((side - bh) / 2);
  return frames.map((f) => {
    const out = blank(side);
    const rows = Math.min(bh, f.height - box.y0);
    const cols = Math.min(bw, f.width - box.x0);
    for (let y = 0; y < rows; y++) {
      const from = ((box.y0 + y) * f.width + box.x0) * 4;
      out.data.set(f.data.subarray(from, from + cols * 4), ((oy + y) * side + ox) * 4);
    }
    return side > maxSide ? downsample(out, maxSide, maxSide) : out;
  });
}

function sample(img: Rgba, x: number, y: number): [number, number, number, number] {
  const { width: w, height: h, data } = img;
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      const yy = y0 + j;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      const o = (yy * w + xx) * 4;
      const al = (data[o + 3] / 255) * k;
      r += data[o] * al;
      g += data[o + 1] * al;
      b += data[o + 2] * al;
      a += al;
    }
  }
  if (a <= 0.001) return [0, 0, 0, 0];
  return [r / a, g / a, b / a, a];
}

function over(dst: Rgba, x: number, y: number, r: number, g: number, b: number, a: number) {
  if (a <= 0) return;
  const o = (y * dst.width + x) * 4;
  const d = dst.data;
  const da = d[o + 3] / 255;
  const out = a + da * (1 - a);
  d[o] = (r * a + d[o] * da * (1 - a)) / out;
  d[o + 1] = (g * a + d[o + 1] * da * (1 - a)) / out;
  d[o + 2] = (b * a + d[o + 2] * da * (1 - a)) / out;
  d[o + 3] = Math.round(out * 255);
}

/** Finds the pointing axis of a photo: tip is the hotspot, tail the farthest solid pixel from it. */
export function shardOf(photo: Rgba, tipX: number, tipY: number): Shard {
  let best = 0;
  let tx = tipX;
  let ty = tipY;
  for (let y = 0; y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      if (photo.data[(y * photo.width + x) * 4 + 3] < 160) continue;
      const d = (x - tipX) ** 2 + (y - tipY) ** 2;
      if (d > best) {
        best = d;
        tx = x;
        ty = y;
      }
    }
  }
  return {
    img: photo,
    tipX,
    tipY,
    dir: Math.atan2(tipY - ty, tipX - tx),
    len: Math.max(1, Math.sqrt(best)),
  };
}

/** Draws the shard so its tip lands on (x, y), pointing at `angle`, `length` pixels long. */
function drawShard(dst: Rgba, shard: Shard, x: number, y: number, angle: number, length: number) {
  let src = shard.img;
  let scale = length / shard.len;
  let tipX = shard.tipX;
  let tipY = shard.tipY;
  // Box-filter down first so the bilinear pass never skips source pixels.
  const pre = Math.min(1, scale * 1.4);
  if (pre < 1) {
    const w = Math.max(2, Math.round(src.width * pre));
    const h = Math.max(2, Math.round(src.height * pre));
    const kx = w / src.width;
    const ky = h / src.height;
    src = downsample(src, w, h);
    tipX *= kx;
    tipY *= ky;
    scale /= kx;
  }
  const rot = angle - shard.dir;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  for (let py = 0; py < dst.height; py++) {
    for (let px = 0; px < dst.width; px++) {
      const dx = (px + 0.5 - x) / scale;
      const dy = (py + 0.5 - y) / scale;
      const sx = tipX + dx * cos - dy * sin;
      const sy = tipY + dx * sin + dy * cos;
      if (sx < -1 || sy < -1 || sx > src.width + 1 || sy > src.height + 1) continue;
      const [r, g, b, a] = sample(src, sx, sy);
      over(dst, px, py, r, g, b, a);
    }
  }
}

function halo(
  dst: Rgba,
  cx: number,
  cy: number,
  rad: number,
  rgb: [number, number, number],
  strength: number,
) {
  for (let y = 0; y < dst.height; y++) {
    for (let x = 0; x < dst.width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rad;
      if (d >= 1) continue;
      const a = (1 - d) * (1 - d) * strength;
      over(dst, x, y, rgb[0], rgb[1], rgb[2], a);
    }
  }
}

export function shardUp(shard: Shard) {
  const img = blank();
  drawShard(img, shard, 48, 6, -Math.PI / 2, 86);
  return { frames: [img], hx: 48, hy: 6 };
}

export function shardResize(shard: Shard, angle: number) {
  const img = blank();
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const reach = 44;
  drawShard(img, shard, 48 + ux * reach, 48 + uy * reach, angle, 40);
  drawShard(img, shard, 48 - ux * reach, 48 - uy * reach, angle + Math.PI, 40);
  return { frames: [img], hx: 48, hy: 48 };
}

export function shardMove(shard: Shard) {
  const img = blank();
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    drawShard(img, shard, 48 + Math.cos(a) * 45, 48 + Math.sin(a) * 45, a, 36);
  }
  return { frames: [img], hx: 48, hy: 48 };
}

/** Three shards chasing each other round a soft core. One frame per step. */
export function shardOrbit(shard: Shard, glow: [number, number, number], steps = 8) {
  const frames: Rgba[] = [];
  for (let f = 0; f < steps; f++) {
    const img = blank();
    halo(img, 48, 48, 20, glow, 0.55);
    for (let k = 0; k < 3; k++) {
      const phase = ((f / steps + k / 3) * Math.PI * 2) % (Math.PI * 2);
      const r = 28;
      const x = 48 + Math.cos(phase) * r;
      const y = 48 + Math.sin(phase) * r;
      drawShard(img, shard, x, y, phase + Math.PI / 2, 34);
    }
    frames.push(img);
  }
  return { frames, hx: 48, hy: 48 };
}

/** Largest fully solid square in the photo, scaled to a tile. Null when the photo is too thin. */
export function textureTile(photo: Rgba, n = S): Rgba | null {
  const { width: w, height: h, data } = photo;
  const dp = new Uint16Array(w * h);
  let best = 0;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] < 235) continue;
      const v = x && y ? Math.min(dp[i - 1], dp[i - w], dp[i - w - 1]) + 1 : 1;
      dp[i] = v;
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  if (best < Math.max(10, Math.min(w, h) * 0.08)) return null;
  const crop = blank(best);
  for (let y = 0; y < best; y++) {
    const from = ((by - best + 1 + y) * w + (bx - best + 1)) * 4;
    crop.data.set(data.subarray(from, from + best * 4), y * best * 4);
  }
  if (best === n) return crop;
  if (best > n) return downsample(crop, n, n);
  const out = blank(n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [r, g, b] = sample(crop, ((x + 0.5) * best) / n, ((y + 0.5) * best) / n);
      const o = (y * n + x) * 4;
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function luma(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Pours the photo texture into a template. Template brightness becomes the lighting. */
export function crystalize(template: Rgba, tex: Rgba): Rgba {
  const out: Rgba = {
    width: template.width,
    height: template.height,
    data: new Uint8ClampedArray(template.data),
  };
  const d = out.data;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const o = (y * out.width + x) * 4;
      if (d[o + 3] === 0) continue;
      const t = ((y % tex.height) * tex.width + (x % tex.width)) * 4;
      const light = luma(d[o], d[o + 1], d[o + 2]);
      const k = 0.25 + light * 1.05;
      for (let c = 0; c < 3; c++) {
        d[o + c] = Math.min(255, tex.data[t + c] * k * 0.72 + d[o + c] * 0.28);
      }
    }
  }
  return out;
}
