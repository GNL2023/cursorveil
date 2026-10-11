import type { Rgba } from "@/lib/cursor/types";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function fourcc(id: string) {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i) & 255;
  return out;
}

function chunk(id: string, data: Uint8Array) {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  out.set(fourcc(id), 0);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function asciiZ(value: string) {
  const clean = value.replace(/[^\x20-\x7e]/g, "").slice(0, 48) || "LUCENT";
  const out = new Uint8Array(clean.length + 1);
  for (let i = 0; i < clean.length; i++) out[i] = clean.charCodeAt(i);
  return out;
}

/** 32-bit CUR. XOR bitmap is premultiplied BGRA; AND mask marks empty pixels. */
export function encodeCur(frame: Rgba, hotspotX: number, hotspotY: number) {
  const w = frame.width;
  const h = frame.height;
  const headerSize = 40;
  const xorSize = w * h * 4;
  const andStride = Math.ceil(w / 32) * 4;
  const andSize = andStride * h;
  const dib = new Uint8Array(headerSize + xorSize + andSize);
  const view = new DataView(dib.buffer);
  view.setUint32(0, 40, true);
  view.setInt32(4, w, true);
  view.setInt32(8, h * 2, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, 32, true);
  view.setUint32(20, xorSize + andSize, true);

  const src = frame.data;
  let p = headerSize;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = src[i + 3];
      dib[p++] = Math.round((src[i + 2] * a) / 255);
      dib[p++] = Math.round((src[i + 1] * a) / 255);
      dib[p++] = Math.round((src[i] * a) / 255);
      dib[p++] = a;
    }
  }
  let and = headerSize + xorSize;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] < 128) dib[and + (x >> 3)] |= 0x80 >> (x & 7);
    }
    and += andStride;
  }

  const hx = clampInt(hotspotX, 0, w - 1);
  const hy = clampInt(hotspotY, 0, h - 1);
  const file = new Uint8Array(22 + dib.length);
  const dv = new DataView(file.buffer);
  dv.setUint16(2, 2, true);
  dv.setUint16(4, 1, true);
  file[6] = w >= 256 ? 0 : w;
  file[7] = h >= 256 ? 0 : h;
  dv.setUint16(10, hx, true);
  dv.setUint16(12, hy, true);
  dv.setUint32(14, dib.length, true);
  dv.setUint32(18, 22, true);
  file.set(dib, 22);
  return file;
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

export function jiffiesForFps(fps: number) {
  return Math.max(1, Math.min(60, Math.round(60 / Math.max(1, fps))));
}

export function encodeAni(frames: Rgba[], hotspotX: number, hotspotY: number, fps: number, title: string) {
  if (!frames.length) throw new Error("Geen frames");
  const count = frames.length;
  const anih = new Uint8Array(36);
  const hv = new DataView(anih.buffer);
  hv.setUint32(0, 36, true);
  hv.setUint32(4, count, true);
  hv.setUint32(8, count, true);
  hv.setUint32(28, jiffiesForFps(fps), true);
  hv.setUint32(32, 1, true);

  const rate = new Uint8Array(count * 4);
  const rv = new DataView(rate.buffer);
  const jif = jiffiesForFps(fps);
  for (let i = 0; i < count; i++) rv.setUint32(i * 4, jif, true);

  const icons = frames.map((frame) => chunk("icon", encodeCur(frame, hotspotX, hotspotY)));
  const info = chunk("LIST", concat([fourcc("INFO"), chunk("INAM", asciiZ(title)), chunk("IART", asciiZ("LUCENT"))]));
  const fram = chunk("LIST", concat([fourcc("fram"), ...icons]));
  let body = concat([fourcc("ACON"), info, chunk("anih", anih), chunk("rate", rate), fram]);
  if (body.length & 1) {
    const padded = new Uint8Array(body.length + 1);
    padded.set(body);
    body = padded;
  }
  const file = new Uint8Array(8 + body.length);
  file.set(fourcc("RIFF"), 0);
  new DataView(file.buffer).setUint32(4, body.length, true);
  file.set(body, 8);
  return file;
}

export type ZipEntry = { name: string; data: Uint8Array };

export function zipStore(files: ZipEntry[]) {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, file.data.length, true);
    dv.setUint32(22, file.data.length, true);
    dv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, file.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + file.data.length;
  }
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, ...central, end]);
}
