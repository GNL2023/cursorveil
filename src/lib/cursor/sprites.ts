import { autoHotspot } from "@/lib/cursor/process";
import { ROLES, type RoleId, type ThemeId } from "@/lib/cursor/roles";
import type { Rgba } from "@/lib/cursor/types";

export type Glyph = { frames: Rgba[]; hx: number; hy: number };

type C = [number, number, number, number];

type Mat = { edge: C; body: C; hi: C; accent: C; deep: C; magic: boolean };

const MAT: Record<ThemeId, Mat> = {
  ether: {
    edge: [8, 22, 32, 255],
    body: [96, 190, 210, 255],
    hi: [220, 248, 255, 255],
    accent: [176, 146, 255, 255],
    deep: [28, 64, 86, 255],
    magic: false,
  },
  mage: {
    edge: [36, 6, 16, 255],
    body: [132, 28, 54, 255],
    hi: [214, 78, 102, 255],
    accent: [86, 232, 222, 255],
    deep: [96, 32, 160, 255],
    magic: true,
  },
  bronze: {
    edge: [32, 18, 10, 255],
    body: [164, 108, 46, 255],
    hi: [232, 194, 116, 255],
    accent: [86, 58, 32, 255],
    deep: [62, 40, 22, 255],
    magic: false,
  },
};

const S = 96;

class Plot {
  img: Rgba;

  constructor(img: Rgba) {
    this.img = img;
  }

  static blank(n = S) {
    return new Plot({ width: n, height: n, data: new Uint8ClampedArray(n * n * 4) });
  }

  pix(x: number, y: number, c: C) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const { width: w, height: h, data } = this.img;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
    const o = (iy * w + ix) * 4;
    const src = c[3] / 255;
    const dst = data[o + 3] / 255;
    const out = src + dst * (1 - src);
    if (out <= 0) return;
    data[o] = (c[0] * src + data[o] * dst * (1 - src)) / out;
    data[o + 1] = (c[1] * src + data[o + 1] * dst * (1 - src)) / out;
    data[o + 2] = (c[2] * src + data[o + 2] * dst * (1 - src)) / out;
    data[o + 3] = Math.round(out * 255);
  }

  disc(x: number, y: number, rad: number, c: C) {
    const r = Math.max(0.5, rad);
    const y0 = Math.floor(y - r);
    const y1 = Math.ceil(y + r);
    const x0 = Math.floor(x - r);
    const x1 = Math.ceil(x + r);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        const dy = yy + 0.5 - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        const edge = Math.min(1, (r - d) * 1.6);
        this.pix(xx, yy, [c[0], c[1], c[2], c[3] * edge]);
      }
    }
  }

  stroke(x0: number, y0: number, x1: number, y1: number, thick: number, c: C) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick / 2, c);
    }
  }

  fill(pts: [number, number][], c: C) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const cross = (a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y);
        if (!cross || b[1] === a[1]) continue;
        xs.push(a[0] + ((y + 0.5 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.floor(xs[i]); x <= Math.ceil(xs[i + 1]); x++) this.pix(x, y, c);
      }
    }
  }

  ring(x: number, y: number, rad: number, thick: number, c: C) {
    const outer = rad;
    const inner = Math.max(0, rad - thick);
    const y0 = Math.floor(y - outer);
    const y1 = Math.ceil(y + outer);
    const x0 = Math.floor(x - outer);
    const x1 = Math.ceil(x + outer);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
        if (d > outer || d < inner) continue;
        const edge = Math.min(d - inner, outer - d, 1.2);
        this.pix(xx, yy, [c[0], c[1], c[2], c[3] * Math.min(1, edge * 1.5)]);
      }
    }
  }

  outline(pts: [number, number][], thick: number, c: C) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      this.stroke(a[0], a[1], b[0], b[1], thick, c);
    }
  }
}

function glyph(p: Plot, x: number, y: number): Glyph {
  return { frames: [p.img], hx: x, hy: y };
}

function sparks(p: Plot, pts: [number, number][], m: Mat) {
  if (!m.magic) return;
  pts.forEach(([x, y], i) => {
    const c = i % 2 === 0 ? m.accent : m.hi;
    p.disc(x, y, i % 3 === 0 ? 1.8 : 1.25, c);
  });
}

function glassArrow(p: Plot, m: Mat) {
  const pts: [number, number][] = [
    [16, 12],
    [16, 64],
    [34, 48],
    [46, 76],
    [58, 66],
    [44, 40],
    [72, 40],
  ];
  p.outline(pts, 7, m.edge);
  p.fill(pts, m.body);
  p.fill(
    [
      [22, 24],
      [22, 46],
      [34, 38],
    ],
    m.accent,
  );
  p.fill(
    [
      [18, 16],
      [18, 30],
      [30, 24],
    ],
    m.hi,
  );
  return { x: 16, y: 12 };
}

function staffArrow(p: Plot, m: Mat) {
  const x0 = 18;
  const y0 = 14;
  const x1 = 78;
  const y1 = 80;
  const thick = m.magic ? 9 : 15;
  p.stroke(x0, y0, x1, y1, thick + 5, m.edge);
  p.stroke(x0, y0, x1, y1, thick, m.body);
  p.stroke(x0 + 2, y0 + 1, x1 - 1, y1 - 3, 3, m.hi);
  if (m.magic) {
    p.disc(x0, y0, 8, m.deep);
    p.disc(x0, y0, 5, m.accent);
    p.disc(x0, y0, 2, m.hi);
    p.disc(x1, y1, 5, m.deep);
    sparks(p, [
      [32, 22],
      [28, 36],
      [48, 34],
      [44, 52],
      [62, 48],
      [58, 66],
      [70, 28],
    ], m);
  } else {
    p.disc(x0 + 4, y0 + 4, 6, m.deep);
    p.disc(x0, y0, 3.4, m.hi);
    p.disc(x1, y1, 9, m.edge);
    p.disc(x1, y1, 6, m.body);
    p.disc(x1 - 2, y1 - 2, 2.4, m.hi);
    p.disc(46, 44, 8, m.edge);
    p.disc(46, 44, 5, m.hi);
    p.disc(62, 62, 7, m.deep);
    p.disc(62, 62, 4, m.body);
  }
  return { x: x0, y: y0 };
}

function paintArrow(p: Plot, theme: ThemeId) {
  return theme === "ether" ? glassArrow(p, MAT[theme]) : staffArrow(p, MAT[theme]);
}

function question(p: Plot, cx: number, cy: number, s: number, c: C) {
  const r = s * 0.38;
  for (let a = -2.5; a < 0.85; a += 0.22) {
    p.disc(cx + Math.cos(a) * r, cy - s * 0.16 + Math.sin(a) * r, Math.max(1.2, s * 0.16), c);
  }
  p.stroke(cx, cy + s * 0.22, cx, cy + s * 0.5, Math.max(2, s * 0.2), c);
  p.disc(cx, cy + s * 0.74, Math.max(1.3, s * 0.14), c);
}

function hourglass(p: Plot, cx: number, cy: number, s: number, edge: C, body: C) {
  p.fill(
    [
      [cx - s, cy - s],
      [cx + s, cy - s],
      [cx, cy],
    ],
    edge,
  );
  p.fill(
    [
      [cx - s, cy + s],
      [cx + s, cy + s],
      [cx, cy],
    ],
    edge,
  );
  const inset = Math.max(2, s * 0.28);
  p.fill(
    [
      [cx - s + inset, cy - s + 2],
      [cx + s - inset, cy - s + 2],
      [cx, cy - 2],
    ],
    body,
  );
  p.fill(
    [
      [cx - s + inset, cy + s - 2],
      [cx + s - inset, cy + s - 2],
      [cx, cy + 2],
    ],
    body,
  );
  p.stroke(cx - s, cy - s, cx + s, cy - s, 2.4, edge);
  p.stroke(cx - s, cy + s, cx + s, cy + s, 2.4, edge);
}

function badge(p: Plot, x: number, y: number, rad: number, m: Mat, kind: "help" | "wait") {
  p.disc(x, y, rad, [4, 6, 8, 230]);
  p.ring(x, y, rad * 0.78, Math.max(2, rad * 0.16), m.accent);
  if (kind === "help") question(p, x, y - rad * 0.06, rad * 0.85, m.hi);
  else hourglass(p, x, y, rad * 0.42, m.hi, m.accent);
  if (m.magic) sparks(p, [
    [x + rad * 0.9, y - rad],
    [x - rad, y + rad * 0.2],
  ], m);
}

function ibeam(p: Plot, m: Mat) {
  p.stroke(48, 16, 48, 80, 12, m.edge);
  p.stroke(30, 16, 66, 16, 12, m.edge);
  p.stroke(30, 80, 66, 80, 12, m.edge);
  p.stroke(48, 20, 48, 76, 4, m.body);
  p.stroke(33, 16, 63, 16, 4, m.hi);
  p.stroke(33, 80, 63, 80, 4, m.hi);
  sparks(p, [
    [74, 28],
    [22, 48],
    [76, 70],
  ], m);
  return glyph(p, 48, 48);
}

function cross(p: Plot, m: Mat) {
  const arms: [number, number, number, number][] = [
    [14, 48, 40, 48],
    [56, 48, 82, 48],
    [48, 14, 48, 40],
    [48, 56, 48, 82],
  ];
  for (const a of arms) p.stroke(a[0], a[1], a[2], a[3], 8, m.edge);
  for (const a of arms) p.stroke(a[0], a[1], a[2], a[3], 3, m.hi);
  p.disc(48, 48, 2.2, m.accent);
  sparks(p, [
    [18, 22],
    [76, 20],
    [74, 76],
  ], m);
  return glyph(p, 48, 48);
}

function wait(p: Plot, m: Mat) {
  hourglass(p, 48, 48, 28, m.edge, m.body);
  hourglass(p, 48, 48, 22, m.body, m.hi);
  p.disc(48, 40, 3, m.accent);
  sparks(p, [
    [18, 22],
    [76, 18],
    [16, 74],
    [78, 72],
    [48, 12],
    [84, 48],
  ], m);
  return glyph(p, 48, 48);
}

function no(p: Plot, m: Mat) {
  p.ring(48, 48, 30, 8, m.edge);
  p.ring(48, 48, 30, 3.5, m.hi);
  p.stroke(28, 28, 68, 68, 8, m.edge);
  p.stroke(28, 28, 68, 68, 3.5, m.accent);
  sparks(p, [
    [16, 48],
    [80, 18],
  ], m);
  return glyph(p, 48, 48);
}

function pen(p: Plot, m: Mat) {
  p.stroke(22, 16, 76, 74, 11, m.edge);
  p.stroke(24, 18, 74, 72, 5, m.body);
  p.stroke(26, 20, 70, 66, 2, m.hi);
  p.disc(18, 14, 5, m.edge);
  p.disc(18, 14, 2.6, m.hi);
  p.disc(78, 78, 6, m.deep);
  sparks(p, [
    [40, 24],
    [34, 48],
    [62, 40],
  ], m);
  return glyph(p, 18, 14);
}

function up(p: Plot, m: Mat) {
  const head: [number, number][] = [
    [48, 12],
    [26, 40],
    [40, 40],
    [40, 82],
    [56, 82],
    [56, 40],
    [70, 40],
  ];
  p.outline(head, 6, m.edge);
  p.fill(head, m.body);
  p.stroke(48, 20, 48, 74, 3, m.hi);
  if (!m.magic) p.disc(48, 78, 7, m.deep);
  sparks(p, [
    [74, 22],
    [22, 48],
    [74, 70],
  ], m);
  return glyph(p, 48, 12);
}

function hand(p: Plot, m: Mat) {
  const mitt: [number, number][] = [
    [42, 12],
    [34, 18],
    [34, 46],
    [24, 54],
    [20, 68],
    [32, 76],
    [36, 64],
    [36, 84],
    [78, 86],
    [84, 74],
    [76, 58],
    [76, 46],
    [68, 42],
    [68, 34],
    [60, 32],
    [60, 24],
    [52, 22],
    [52, 12],
  ];
  p.outline(mitt, 6, m.edge);
  p.fill(mitt, m.body);
  p.stroke(46, 16, 46, 40, 3, m.hi);
  p.disc(40, 70, 4, m.deep);
  sparks(p, [
    [70, 18],
    [18, 40],
    [84, 64],
  ], m);
  return glyph(p, 42, 12);
}

function headAt(p: Plot, x: number, y: number, ang: number, m: Mat) {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const px = -uy;
  const py = ux;
  const tip: [number, number][] = [
    [x + ux * 14, y + uy * 14],
    [x + px * 8 - ux * 2, y + py * 8 - uy * 2],
    [x - px * 8 - ux * 2, y - py * 8 - uy * 2],
  ];
  p.fill(tip, m.edge);
  p.fill(
    [
      [x + ux * 11, y + uy * 11],
      [x + px * 4, y + py * 4],
      [x - px * 4, y - py * 4],
    ],
    m.hi,
  );
}

function axis(p: Plot, ang: number, m: Mat, both = true) {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const len = 28;
  p.stroke(48 - ux * len, 48 - uy * len, 48 + ux * len, 48 + uy * len, 7, m.edge);
  p.stroke(48 - ux * len, 48 - uy * len, 48 + ux * len, 48 + uy * len, 2.5, m.hi);
  headAt(p, 48 + ux * (len - 6), 48 + uy * (len - 6), ang, m);
  if (both) headAt(p, 48 - ux * (len - 6), 48 - uy * (len - 6), ang + Math.PI, m);
}

function sizes(p: Plot, ang: number, m: Mat) {
  axis(p, ang, m);
  sparks(p, [
    [16, 16],
    [80, 18],
    [78, 80],
  ], m);
  return glyph(p, 48, 48);
}

function move(p: Plot, m: Mat) {
  axis(p, 0, m);
  axis(p, Math.PI / 2, m);
  p.disc(48, 48, 4, m.edge);
  p.disc(48, 48, 2, m.accent);
  return glyph(p, 48, 48);
}

function helpOf(theme: ThemeId) {
  const p = Plot.blank();
  paintArrow(p, theme);
  badge(p, 78, 24, 14, MAT[theme], "help");
  const hot = theme === "ether" ? { x: 16, y: 12 } : { x: 18, y: 14 };
  return glyph(p, hot.x, hot.y);
}

function startingOf(theme: ThemeId) {
  const p = Plot.blank();
  paintArrow(p, theme);
  badge(p, 78, 70, 14, MAT[theme], "wait");
  const hot = theme === "ether" ? { x: 16, y: 12 } : { x: 18, y: 14 };
  return glyph(p, hot.x, hot.y);
}

export function paintTemplates(theme: ThemeId): Record<RoleId, Glyph> {
  const m = MAT[theme];
  const arrow = Plot.blank();
  const tip = paintArrow(arrow, theme);
  const map = {
    arrow: glyph(arrow, tip.x, tip.y),
    help: helpOf(theme),
    appstarting: startingOf(theme),
    wait: wait(Plot.blank(), m),
    cross: cross(Plot.blank(), m),
    ibeam: ibeam(Plot.blank(), m),
    nwpen: pen(Plot.blank(), m),
    no: no(Plot.blank(), m),
    sizens: sizes(Plot.blank(), Math.PI / 2, m),
    sizewe: sizes(Plot.blank(), 0, m),
    sizenwse: sizes(Plot.blank(), Math.PI / 4, m),
    sizenesw: sizes(Plot.blank(), -Math.PI / 4, m),
    sizeall: move(Plot.blank(), m),
    up: up(Plot.blank(), m),
    hand: hand(Plot.blank(), m),
  } satisfies Record<RoleId, Glyph>;
  return map;
}

function clone(img: Rgba): Rgba {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function sampleAlpha(img: Rgba, x: number, y: number, rad: number) {
  let s = 0;
  let n = 0;
  const r = Math.max(2, rad);
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy += 2) {
    for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx += 2) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      s += img.data[(yy * img.width + xx) * 4 + 3];
      n++;
    }
  }
  return n ? s / n / 255 : 1;
}

function placeBadge(img: Rgba, hx: number, hy: number) {
  const rad = Math.max(22, Math.round(Math.min(img.width, img.height) * 0.085));
  const spots = [
    [img.width - rad * 1.35, rad * 1.35],
    [rad * 1.35, img.height - rad * 1.35],
    [img.width - rad * 1.25, img.height * 0.55],
    [img.width * 0.55, rad * 1.2],
  ];
  let best = { x: spots[0][0], y: spots[0][1], score: Infinity };
  for (const [x, y] of spots) {
    const dist = Math.hypot(x - hx, y - hy) / img.width;
    const score = sampleAlpha(img, x, y, rad * 0.7) * 1.6 + (1 - dist);
    if (score < best.score) best = { x, y, score };
  }
  return { ...best, rad };
}

function stamp(photo: Rgba, theme: ThemeId, kind: "help" | "wait", hx: number, hy: number): Glyph {
  const copy = clone(photo);
  const spot = placeBadge(copy, hx, hy);
  badge(new Plot(copy), spot.x, spot.y, spot.rad, MAT[theme], kind);
  return { frames: [copy], hx, hy };
}

export function withPhoto(templates: Record<RoleId, Glyph>, photo: Rgba, theme: ThemeId): Record<RoleId, Glyph> {
  const hot = autoHotspot(photo);
  const next = { ...templates };
  next.arrow = { frames: [photo], hx: hot.x, hy: hot.y };
  next.help = stamp(photo, theme, "help", hot.x, hot.y);
  next.appstarting = stamp(photo, theme, "wait", hot.x, hot.y);
  return next;
}

export function roleById(id: string) {
  return ROLES.find((role) => role.id === id);
}
