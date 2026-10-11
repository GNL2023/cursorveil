import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { Download, ImagePlus, Maximize2, Pause, Play, RotateCcw, Sparkles } from "lucide-react";
import { framePng, buildScheme } from "@/lib/cursor/pack";
import { squareFrames } from "@/lib/cursor/crystal";
import {
  autoHotspot,
  bitmapToRgba,
  outputHotspot,
  renderClean,
  renderFrames,
} from "@/lib/cursor/process";
import { ROLES, THEME_SRC, THEMES, type RoleId, type ThemeId } from "@/lib/cursor/roles";
import { paintTemplates, withPhoto, type Glyph } from "@/lib/cursor/sprites";
import {
  DEFAULT_SETTINGS,
  FPS,
  PIXELS,
  SIZES,
  type Algo,
  type ForgeSettings,
  type Motion,
  type PaletteId,
  type Rgba,
} from "@/lib/cursor/types";

const STORAGE = "lucent-forge-v2";

const ALGOS: { id: Algo; name: string }[] = [
  { id: "bayer", name: "Bayer" },
  { id: "floyd", name: "Floyd" },
  { id: "atkinson", name: "Atkinson" },
];

const PALETTES: { id: PaletteId; name: string }[] = [
  { id: "glass", name: "Glas" },
  { id: "mage", name: "Magie" },
  { id: "bronze", name: "Brons" },
  { id: "silver", name: "Zilver" },
  { id: "mono", name: "Mono" },
  { id: "source", name: "Eigen kleur" },
];

const MOTIONS: { id: Motion; name: string }[] = [
  { id: "orb", name: "Orb" },
  { id: "noise", name: "Ruis" },
  { id: "breath", name: "Adem" },
  { id: "scan", name: "Scan" },
  { id: "flicker", name: "Flits" },
  { id: "still", name: "Stil" },
];

/** Two glow colours per theme. They tint the whole page around the cursor. */
const GLOW: Record<ThemeId, { a: string; b: string; line: string }> = {
  ether: { a: "158 231 255", b: "176 146 255", line: "Kristal dat licht breekt." },
  mage: { a: "214 58 96", b: "86 232 222", line: "Een staf vol oude magie." },
  bronze: { a: "232 170 92", b: "164 108 46", line: "Gesmeed brons, zwaar in de hand." },
};

type Drawn = { frames: Rgba[]; hx: number; hy: number };
type Manual = { x: number; y: number };

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function num(v: unknown, fallback: number, lo: number, hi: number) {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function sanitize(current: ForgeSettings, raw?: Partial<ForgeSettings>): ForgeSettings {
  if (!raw) return current;
  return {
    size: (SIZES as readonly number[]).includes(raw.size as number)
      ? (raw.size as number)
      : current.size,
    pixel: (PIXELS as readonly number[]).includes(raw.pixel as number)
      ? (raw.pixel as number)
      : current.pixel,
    fps: (FPS as readonly number[]).includes(raw.fps as number) ? (raw.fps as number) : current.fps,
    algo: ALGOS.some((a) => a.id === raw.algo) ? (raw.algo as Algo) : current.algo,
    palette: PALETTES.some((p) => p.id === raw.palette)
      ? (raw.palette as PaletteId)
      : current.palette,
    motion: MOTIONS.some((m) => m.id === raw.motion) ? (raw.motion as Motion) : current.motion,
    levels: Math.round(num(raw.levels, current.levels, 2, 8)),
    contrast: num(raw.contrast, current.contrast, 0.6, 2.2),
    brightness: num(raw.brightness, current.brightness, -0.35, 0.45),
    chroma: num(raw.chroma, current.chroma, 0, 3),
    glow: num(raw.glow, current.glow, 0, 1),
    motionAmt: num(raw.motionAmt, current.motionAmt, 0, 1),
    frames: Math.round(num(raw.frames, current.frames, 2, 12)),
  };
}

function isTheme(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

function isRole(v: unknown): v is RoleId {
  return ROLES.some((r) => r.id === v);
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "lucent-cursor"
  );
}

function download(bytes: Uint8Array, name: string, type: string) {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Which cursor a real element would get. `data-role` wins; otherwise links get the hand, fields the I-beam. */
function roleForElement(el: Element | null): RoleId {
  if (!el) return "arrow";
  const tagged = el.closest<HTMLElement>("[data-role]");
  const role = tagged?.dataset.role;
  if (isRole(role)) return role;
  if (el.closest("textarea, input:not([type=range]):not([type=checkbox]):not([type=file])"))
    return "ibeam";
  if (el.closest("a, button, label, [role=button], input[type=range]")) return "hand";
  return "arrow";
}

let scratch: HTMLCanvasElement | null = null;

/** Synchronous PNG data URL. toBlob is far too slow for 40+ frames on every slider move. */
function toUrl(frame: Rgba) {
  scratch ??= document.createElement("canvas");
  scratch.width = frame.width;
  scratch.height = frame.height;
  const ctx = scratch.getContext("2d");
  if (!ctx) return "";
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height),
    0,
    0,
  );
  return scratch.toDataURL("image/png");
}

/** Data URLs for a set of frame lists. Empty during SSR, filled on the client. */
function useUrls<K extends string>(map: Record<K, Rgba[]>) {
  const [client, setClient] = useState(false);
  useEffect(() => setClient(true), []);
  return useMemo(() => {
    const next: Partial<Record<K, string[]>> = {};
    if (!client) return next;
    for (const key of Object.keys(map) as K[]) next[key] = map[key].map(toUrl);
    return next;
  }, [map, client]);
}

export function ForgeApp() {
  const [settings, setSettings] = useState<ForgeSettings>(DEFAULT_SETTINGS);
  const [packName, setPackName] = useState("etherpijl");
  const [theme, setTheme] = useState<ThemeId>("ether");
  const [role, setRole] = useState<RoleId>("arrow");
  const [hoverRole, setHoverRole] = useState<RoleId | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<ThemeId, Rgba>>>({});
  const [overrides, setOverrides] = useState<
    Partial<Record<ThemeId, Partial<Record<RoleId, Rgba[]>>>>
  >({});
  const [manuals, setManuals] = useState<Partial<Record<string, Manual>>>({});
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0);
  const [scrub, setScrub] = useState(0);
  const [compare, setCompare] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  const [overStage, setOverStage] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Kristal laden…");
  const [ready, setReady] = useState(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const fullPageRef = useRef(fullPage);
  fullPageRef.current = fullPage;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          settings?: Partial<ForgeSettings>;
          packName?: string;
          theme?: ThemeId;
          role?: RoleId;
          manuals?: Partial<Record<string, Manual>>;
        };
        setSettings((current) => sanitize(current, parsed.settings));
        if (typeof parsed.packName === "string" && parsed.packName.trim())
          setPackName(parsed.packName.slice(0, 40));
        if (isTheme(parsed.theme)) setTheme(parsed.theme);
        if (isRole(parsed.role)) setRole(parsed.role);
        if (parsed.manuals && typeof parsed.manuals === "object") {
          const next: Partial<Record<string, Manual>> = {};
          for (const [key, value] of Object.entries(parsed.manuals)) {
            if (value && typeof value.x === "number" && typeof value.y === "number") {
              next[key] = { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) };
            }
          }
          setManuals(next);
        }
      }
    } catch {
      /* keep defaults */
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ settings, packName, theme, role, manuals }));
    } catch {
      /* storage full or blocked */
    }
  }, [ready, settings, packName, theme, role, manuals]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const loaded = await Promise.all(
          THEMES.map(async (item) => {
            const response = await fetch(THEME_SRC[item.id]);
            if (!response.ok) throw new Error("bron");
            const bitmap = await createImageBitmap(await response.blob());
            const rgba = bitmapToRgba(bitmap);
            bitmap.close();
            return [item.id, squareFrames([rgba])[0]] as const;
          }),
        );
        if (cancel) return;
        setPhotos(Object.fromEntries(loaded) as Partial<Record<ThemeId, Rgba>>);
        setStatus("Vijftien aanwijzers, allemaal uit hetzelfde materiaal.");
      } catch {
        if (!cancel) setStatus("Bronnen konden niet laden. De sjablonen blijven staan.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.code === "Escape") setFullPage(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onOver = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const inStage = Boolean(target && stageRef.current?.contains(target));
      if (!inStage && !fullPageRef.current) {
        setHoverRole(null);
        return;
      }
      const next = roleForElement(target);
      setHoverRole((prev) => (prev === next ? prev : next));
    };
    document.addEventListener("pointerover", onOver);
    return () => document.removeEventListener("pointerover", onOver);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const loop = (time: number) => {
      const next = Math.floor(((time - start) / 1000) * settings.fps);
      setTick((prev) => (prev === next ? prev : next));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, settings.fps]);

  const glyphs = useMemo(() => {
    const painted = paintTemplates(theme);
    const photo = photos[theme];
    const base = photo ? withPhoto(painted, photo, theme) : painted;
    const replaced = overrides[theme];
    if (!replaced) return base;
    const next: Record<RoleId, Glyph> = { ...base };
    for (const item of ROLES) {
      const frames = replaced[item.id];
      if (!frames?.length) continue;
      const hot = autoHotspot(frames[0]);
      next[item.id] = { frames, hx: hot.x, hy: hot.y };
    }
    return next;
  }, [theme, photos, overrides]);

  const rendered = useMemo(() => {
    const map = {} as Record<RoleId, Drawn>;
    for (const item of ROLES) {
      const glyph = glyphs[item.id];
      const tuned = item.animate ? settings : { ...settings, motion: "still" as const };
      const frames = renderFrames(glyph.frames, tuned);
      const manual = manuals[`${theme}:${item.id}`];
      const hot = manual
        ? {
            x: clamp(Math.floor(manual.x * frames[0].width), 0, frames[0].width - 1),
            y: clamp(Math.floor(manual.y * frames[0].height), 0, frames[0].height - 1),
          }
        : outputHotspot(glyph.hx, glyph.hy, glyph.frames[0].width, glyph.frames[0].height, tuned);
      map[item.id] = { frames, hx: hot.x, hy: hot.y };
    }
    return map;
  }, [glyphs, settings, manuals, theme]);

  const frameMap = useMemo(() => {
    const map = {} as Record<RoleId, Rgba[]>;
    for (const item of ROLES) map[item.id] = rendered[item.id].frames;
    return map;
  }, [rendered]);
  const urls = useUrls(frameMap);

  const themeMeta = THEMES.find((item) => item.id === theme) ?? THEMES[0];
  const glow = GLOW[theme];
  const pinned = ROLES.find((item) => item.id === role) ?? ROLES[0];
  const liveId = hoverRole ?? role;
  const step = playing ? tick : scrub;
  const at = (len: number) => (len ? step % len : 0);
  const pinnedFrames = rendered[role].frames;
  const pinnedIndex = at(pinnedFrames.length);
  const pinnedSources = glyphs[role].frames;
  const cleanFrames = useMemo(
    () => ({
      clean:
        compare && pinnedSources.length
          ? [renderClean(pinnedSources, settings.size, pinnedIndex)]
          : [],
    }),
    [compare, pinnedSources, settings.size, pinnedIndex],
  );
  const cleanUrls = useUrls(cleanFrames);
  const replaced = Boolean(overrides[theme]?.[role]);

  function urlOf(id: RoleId) {
    const list = urls[id];
    return list?.length ? list[at(list.length)] : undefined;
  }

  function chooseTheme(next: ThemeId) {
    const meta = THEMES.find((item) => item.id === next);
    if (!meta) return;
    setTheme(next);
    setHoverRole(null);
    setPackName(meta.pack);
    setSettings((current) => ({ ...current, ...meta.settings }));
    setStatus(`${meta.name}. ${GLOW[next].line}`);
  }

  async function ingest(list: FileList | File[]) {
    const images = [...list]
      .filter((file) => file.type.startsWith("image/"))
      .sort((a, b) => a.name.localeCompare(b.name, "nl"));
    if (!images.length) {
      setStatus("Alleen PNG, WebP of GIF.");
      return;
    }
    try {
      const raw: Rgba[] = [];
      for (const file of images) {
        const bitmap = await createImageBitmap(file);
        raw.push(bitmapToRgba(bitmap));
        bitmap.close();
      }
      const frames = squareFrames(raw);
      setOverrides((current) => ({ ...current, [theme]: { ...current[theme], [role]: frames } }));
      setManuals((current) => {
        const copy = { ...current };
        delete copy[`${theme}:${role}`];
        return copy;
      });
      const label =
        images.length > 1 ? `${images.length} frames` : images[0].name.replace(/\.[^.]+$/, "");
      setStatus(`${pinned.label} vervangen door ${label}.`);
    } catch {
      setStatus("Dit beeld kon niet gelezen worden.");
    }
  }

  function restoreRole() {
    setOverrides((current) => {
      const themeOverrides = { ...current[theme] };
      delete themeOverrides[role];
      return { ...current, [theme]: themeOverrides };
    });
    setManuals((current) => {
      const copy = { ...current };
      delete copy[`${theme}:${role}`];
      return copy;
    });
    setStatus(`${pinned.label} staat weer op het origineel.`);
  }

  async function exportPack() {
    if (busy) return;
    setBusy(true);
    try {
      const pack = await buildScheme({
        name: packName,
        title: themeMeta.name,
        fps: settings.fps,
        roles: ROLES.map((item) => {
          const drawn = rendered[item.id];
          const animate = item.animate && drawn.frames.length > 1;
          return {
            file: item.file,
            label: item.label,
            windows: item.windows,
            frames: animate ? drawn.frames : [drawn.frames[0]],
            hx: drawn.hx,
            hy: drawn.hy,
            animate,
          };
        }),
      });
      download(pack.bytes, `${pack.slug}.zip`, "application/zip");
      setStatus(`${pack.slug}.zip — 15 aanwijzers, install.inf en een browsertest.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function exportFrame() {
    const frame = pinnedFrames[pinnedIndex];
    if (!frame || busy) return;
    setBusy(true);
    try {
      const bytes = await framePng(frame);
      download(bytes, `${slugify(packName)}-${pinned.file}.png`, "image/png");
      setStatus(`PNG van ${pinned.label}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PNG mislukt");
    } finally {
      setBusy(false);
    }
  }

  function patch(partial: Partial<ForgeSettings>) {
    setSettings((current) => ({ ...current, ...partial }));
  }

  function selectRole(id: RoleId) {
    setRole(id);
    const meta = ROLES.find((item) => item.id === id);
    if (meta) setStatus(`${meta.label}: ${meta.hint}`);
  }

  const live = rendered[liveId];
  const liveSrc = urlOf(liveId);
  const loupeSrc = compare ? cleanUrls.clean?.[0] : urlOf(role);
  const loupeImage = compare ? cleanFrames.clean[0] : pinnedFrames[pinnedIndex];
  const heroPixel = urlOf("arrow");
  const vars = { "--glow-a": glow.a, "--glow-b": glow.b } as CSSProperties;

  return (
    <div
      style={vars}
      className={clsx(
        "aurora relative min-h-screen min-w-0 overflow-x-hidden text-fg",
        fullPage && "cursor-test",
      )}
    >
      <div className="grain pointer-events-none fixed inset-0 z-0" aria-hidden />

      <header className="sticky top-0 z-30 border-b border-white/5 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <div className="mr-auto flex items-center gap-3">
            <span className="logo-mark grid size-10 place-items-center">
              <img src={THEME_SRC[theme]} alt="" className="h-8 w-8 object-contain" />
            </span>
            <div>
              <p className="font-display text-xl leading-none font-extrabold tracking-tight">
                LUCENT
              </p>
              <p className="mt-1 text-[0.65rem] tracking-[0.3em] text-faint uppercase">
                Cursor forge
              </p>
            </div>
          </div>
          <label className="w-full sm:w-52">
            <span className="sr-only">Naam van het pack</span>
            <input
              value={packName}
              onChange={(e) => setPackName(e.target.value.slice(0, 40))}
              placeholder="Naam van het pack"
              className="glass-input min-h-11 w-full px-3 text-sm"
            />
          </label>
          <button
            type="button"
            aria-pressed={fullPage}
            onClick={() => setFullPage((v) => !v)}
            className={clsx(
              "btn-ghost inline-flex min-h-11 items-center gap-2 px-4",
              fullPage && "is-on",
            )}
          >
            <Maximize2 className="size-4" aria-hidden />
            {fullPage ? "Esc: stop" : "Hele pagina"}
          </button>
          <button
            type="button"
            onClick={() => void exportPack()}
            disabled={busy}
            className="btn-prism inline-flex min-h-11 items-center gap-2 px-5"
          >
            <Download className="size-4" aria-hidden />
            {busy ? "Bezig…" : "Exporteer pack"}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[92rem] px-4 sm:px-6">
        {/* Hero: the source in full glory next to the cursor it becomes. */}
        <section className="grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-16">
          <div className="min-w-0">
            <p className="eyebrow">
              <Sparkles className="size-3.5" aria-hidden /> {themeMeta.name} · 15 aanwijzers
            </p>
            <h1 className="sheen mt-5 font-display text-5xl leading-[0.95] font-extrabold tracking-tight text-balance sm:text-6xl xl:text-7xl">
              Glas dat de muis volgt.
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-relaxed text-pretty text-muted sm:text-base">
              {glow.line} Van één beeld naar een compleet Windows-schema: pijl, wachten, tekst,
              hand, formaat — alles uit hetzelfde materiaal, gedithered tot op de pixel en klaar om
              te installeren.
            </p>

            <div className="mt-8 grid grid-cols-3 gap-3" role="radiogroup" aria-label="Thema">
              {THEMES.map((item) => {
                const on = item.id === theme;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => chooseTheme(item.id)}
                    className={clsx("theme-card group grid gap-2 p-3 text-left", on && "is-on")}
                  >
                    <span className="block h-20 overflow-hidden sm:h-24">
                      <img
                        src={THEME_SRC[item.id]}
                        alt=""
                        className="h-full w-full object-contain transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-[-4deg]"
                      />
                    </span>
                    <span className="text-xs font-medium tracking-widest uppercase">
                      {item.name}
                    </span>
                    <span className="hidden text-[0.7rem] leading-snug text-faint sm:block">
                      {item.line}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="showcase relative mx-auto aspect-square w-full max-w-[34rem]">
            <div className="prism" aria-hidden />
            <div className="ring-orbit" aria-hidden />
            <img
              src={THEME_SRC[theme]}
              alt={`${themeMeta.name}, de bron van dit pack`}
              className={clsx(
                "hero-crystal absolute inset-[12%] h-[76%] w-[76%] object-contain",
                playing && "float",
              )}
            />
            <figure className="pixel-chip absolute right-0 bottom-2 grid gap-2 p-3 sm:right-2">
              <span className="checker grid size-24 place-items-center sm:size-28">
                {heroPixel ? (
                  <img src={heroPixel} alt="" className="pixelated size-full" />
                ) : (
                  <span className="text-[0.65rem] text-faint">dither…</span>
                )}
              </span>
              <figcaption className="text-[0.65rem] tracking-widest text-muted uppercase">
                {settings.size} px · {ALGOS.find((a) => a.id === settings.algo)?.name}
              </figcaption>
            </figure>
          </div>
        </section>

        {/* The whole set, live. */}
        <section aria-labelledby="set-title" className="pb-12">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">De set</p>
              <h2 id="set-title" className="mt-3 font-display text-3xl font-bold tracking-tight">
                Vijftien aanwijzers
              </h2>
            </div>
            <p className="max-w-md text-xs leading-relaxed text-muted">
              Kies er een om te bewerken. Beweeg in het testveld hieronder: elke zone krijgt zijn
              eigen cursor.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
            {ROLES.map((item) => {
              const on = item.id === role;
              const live = item.id === hoverRole;
              const src = urlOf(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => selectRole(item.id)}
                  data-role={item.id}
                  className={clsx(
                    "tile group grid gap-2 p-2 text-left sm:p-3",
                    on && "is-on",
                    live && "is-live",
                  )}
                >
                  <span className="tile-well grid aspect-square place-items-center">
                    {src ? (
                      <img
                        src={src}
                        alt=""
                        className="pixelated h-3/5 w-3/5 transition-transform duration-300 group-hover:scale-110"
                      />
                    ) : (
                      <span className="size-6 animate-pulse rounded-full bg-white/5" />
                    )}
                    {item.animate ? <span className="tile-badge">ani</span> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium tracking-wider uppercase">
                      {item.label}
                    </span>
                    <span className="block truncate text-[0.65rem] text-faint">{item.windows}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Workbench */}
        <section className="grid min-w-0 gap-4 pb-16 lg:grid-cols-[19rem_minmax(0,1fr)_20rem]">
          <aside className="panel order-2 min-w-0 lg:order-none">
            <div className="grid gap-6 p-4">
              <section className="grid gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="panel-title">{pinned.label}</h2>
                  <span className="text-[0.65rem] text-faint">{pinned.windows}</span>
                </div>
                <p className="text-xs text-muted">
                  {pinned.hint} Klik in het beeld waar de klik moet vallen. Nu {rendered[role].hx},{" "}
                  {rendered[role].hy}.
                </p>
                <div className="hotspot-pad checker relative mx-auto w-full max-w-64 overflow-hidden rounded-md border border-line">
                  {loupeSrc && loupeImage ? (
                    <HotspotPad
                      src={loupeSrc}
                      image={loupeImage}
                      hx={rendered[role].hx}
                      hy={rendered[role].hy}
                      onPick={(x, y) =>
                        setManuals((current) => ({
                          ...current,
                          [`${theme}:${role}`]: {
                            x: (x + 0.5) / loupeImage.width,
                            y: (y + 0.5) / loupeImage.height,
                          },
                        }))
                      }
                    />
                  ) : (
                    <div className="grid aspect-square place-items-center text-xs text-faint">
                      Dither berekenen…
                    </div>
                  )}
                  {compare ? (
                    <span className="absolute top-2 left-2 text-[0.6rem] tracking-widest text-faint uppercase">
                      Bron
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setManuals((current) => {
                        const copy = { ...current };
                        delete copy[`${theme}:${role}`];
                        return copy;
                      })
                    }
                    className="btn-ghost min-h-10 flex-1 px-3"
                  >
                    Auto-hotspot
                  </button>
                  <button
                    type="button"
                    aria-pressed={compare}
                    onClick={() => setCompare((v) => !v)}
                    className={clsx("btn-ghost min-h-10 flex-1 px-3", compare && "is-on")}
                  >
                    Vergelijk bron
                  </button>
                </div>
              </section>

              <section className="grid gap-3">
                <h2 className="panel-title">Eigen beeld</h2>
                <label
                  className={clsx(
                    "dropzone grid min-h-28 cursor-pointer place-items-center px-4 py-5 text-center",
                    dragOver && "is-over",
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void ingest(e.dataTransfer.files);
                  }}
                >
                  <input
                    type="file"
                    accept="image/png,image/webp,image/gif"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files) void ingest(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <ImagePlus className="mb-2 size-5 text-accent" aria-hidden />
                  <span className="text-sm">Vervang {pinned.label.toLowerCase()}</span>
                  <span className="mt-1 text-xs text-muted">
                    Transparante PNG. Meerdere bestanden worden frames.
                  </span>
                </label>
                {replaced ? (
                  <button
                    type="button"
                    onClick={restoreRole}
                    className="btn-ghost inline-flex min-h-10 items-center justify-center gap-2 px-3"
                  >
                    <RotateCcw className="size-3.5" aria-hidden /> Terug naar origineel
                  </button>
                ) : null}
              </section>
            </div>
          </aside>

          <section
            ref={stageRef}
            aria-label="Testveld"
            className={clsx(
              "panel order-1 flex min-h-[32rem] min-w-0 flex-col overflow-hidden lg:sticky lg:top-20 lg:order-none lg:h-[calc(100vh-6rem)] lg:self-start",
              !fullPage && "cursor-test",
            )}
            onPointerEnter={() => setOverStage(true)}
            onPointerLeave={() => {
              setOverStage(false);
              setPressed(false);
            }}
            onPointerDown={() => setPressed(true)}
            onPointerUp={() => setPressed(false)}
          >
            <TestField />
            <div className="border-t border-white/5 bg-black/20 px-4 py-3">
              <div className="mb-2 flex items-center gap-3">
                <button
                  type="button"
                  aria-pressed={playing}
                  aria-label={playing ? "Pauze" : "Afspelen"}
                  onClick={() => {
                    if (playing) setScrub(tick);
                    setPlaying((v) => !v);
                  }}
                  className="btn-ghost grid size-10 place-items-center"
                >
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
                <p className="text-xs tracking-widest text-muted uppercase tabular-nums">
                  {hoverRole ? (ROLES.find((r) => r.id === hoverRole)?.label ?? "") : pinned.label}{" "}
                  · frame {pinnedFrames.length ? pinnedIndex + 1 : 0}/{pinnedFrames.length}
                </p>
                <p className="ml-auto hidden text-[0.65rem] tracking-widest text-faint uppercase sm:block">
                  Spatie speelt of pauzeert
                </p>
              </div>
              <div className="flex w-full min-w-0 gap-2 overflow-x-auto pb-1">
                {(urls[role] ?? []).map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Frame ${i + 1}`}
                    aria-pressed={i === pinnedIndex}
                    onClick={() => {
                      setPlaying(false);
                      setScrub(i);
                    }}
                    className={clsx(
                      "frame-chip checker shrink-0 p-1",
                      i === pinnedIndex && "is-on",
                    )}
                  >
                    <img src={src} alt="" className="pixelated size-12" />
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="panel order-3 min-w-0 lg:order-none">
            <div className="grid gap-6 p-4">
              <section className="grid gap-4">
                <h2 className="panel-title">Dither</h2>
                <Segment
                  label="Algoritme"
                  value={settings.algo}
                  options={ALGOS}
                  onChange={(algo) => patch({ algo })}
                />
                <Segment
                  label="Palet"
                  value={settings.palette}
                  options={PALETTES}
                  onChange={(palette) => patch({ palette })}
                />
                <Segment
                  label="Maat"
                  value={settings.size}
                  options={SIZES.map((id) => ({ id, name: String(id) }))}
                  onChange={(size) => patch({ size })}
                />
                <Segment
                  label="Pixel"
                  value={settings.pixel}
                  options={PIXELS.map((id) => ({ id, name: `${id}×` }))}
                  onChange={(pixel) => patch({ pixel })}
                />
                <Slider
                  label="Niveaus"
                  min={2}
                  max={8}
                  step={1}
                  value={settings.levels}
                  onChange={(levels) => patch({ levels })}
                />
                <Slider
                  label="Contrast"
                  min={0.6}
                  max={2.2}
                  step={0.05}
                  value={settings.contrast}
                  display={settings.contrast.toFixed(2)}
                  onChange={(contrast) => patch({ contrast })}
                />
                <Slider
                  label="Helder"
                  min={-0.35}
                  max={0.45}
                  step={0.01}
                  value={settings.brightness}
                  display={settings.brightness.toFixed(2)}
                  onChange={(brightness) => patch({ brightness })}
                />
                <Slider
                  label="Chroma"
                  min={0}
                  max={3}
                  step={1}
                  value={settings.chroma}
                  onChange={(chroma) => patch({ chroma })}
                />
                <Slider
                  label="Gloed"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.glow}
                  display={String(Math.round(settings.glow * 100))}
                  onChange={(g) => patch({ glow: g })}
                />
              </section>
              <section className="grid gap-4">
                <h2 className="panel-title">Beweging</h2>
                <Segment
                  label="Soort"
                  value={settings.motion}
                  options={MOTIONS}
                  onChange={(motion) => patch({ motion })}
                />
                <Slider
                  label="Sterkte"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.motionAmt}
                  display={String(Math.round(settings.motionAmt * 100))}
                  onChange={(motionAmt) => patch({ motionAmt })}
                />
                <Slider
                  label="Frames"
                  min={2}
                  max={12}
                  step={1}
                  value={settings.frames}
                  onChange={(frames) => patch({ frames })}
                />
                <Segment
                  label="Snelheid"
                  value={settings.fps}
                  options={FPS.map((id) => ({ id, name: `${id} fps` }))}
                  onChange={(fps) => patch({ fps })}
                />
              </section>
              <section className="grid gap-3 border-t border-white/5 pt-4">
                <button
                  type="button"
                  onClick={() => void exportFrame()}
                  disabled={busy}
                  className="btn-ghost min-h-11 px-3"
                >
                  PNG van {pinned.label.toLowerCase()}
                </button>
                <button
                  type="button"
                  onClick={() => void exportPack()}
                  disabled={busy}
                  className="btn-prism inline-flex min-h-11 items-center justify-center gap-2 px-3"
                >
                  <Download className="size-4" aria-hidden /> Exporteer alle 15
                </button>
                <p className="text-xs leading-relaxed text-muted" role="status" aria-live="polite">
                  {status}
                </p>
              </section>
            </div>
          </aside>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/5 py-6 text-center text-[0.65rem] tracking-widest text-faint uppercase">
        LUCENT · .ani · .cur · install.inf · browsertest
      </footer>

      <FollowCursor
        src={liveSrc}
        width={live.frames[0]?.width ?? 0}
        height={live.frames[0]?.height ?? 0}
        hx={live.hx}
        hy={live.hy}
        visible={Boolean(liveSrc) && (fullPage || overStage)}
        pressed={pressed}
      />
    </div>
  );
}

/** A small fake desktop. Every zone carries the cursor Windows would show there. */
function TestField() {
  return (
    <div className="stage-plate relative grid flex-1 place-items-center p-4 sm:p-8">
      <div className="window relative w-full max-w-xl">
        <span data-role="sizens" className="edge -top-1 right-3 left-3 h-2" aria-hidden />
        <span data-role="sizens" className="edge right-3 -bottom-1 left-3 h-2" aria-hidden />
        <span data-role="sizewe" className="edge top-3 bottom-3 -left-1 w-2" aria-hidden />
        <span data-role="sizewe" className="edge top-3 -right-1 bottom-3 w-2" aria-hidden />
        <span data-role="sizenwse" className="edge -top-1 -left-1 size-4" aria-hidden />
        <span data-role="sizenwse" className="edge -right-1 -bottom-1 size-4" aria-hidden />
        <span data-role="sizenesw" className="edge -top-1 -right-1 size-4" aria-hidden />
        <span data-role="sizenesw" className="edge -bottom-1 -left-1 size-4" aria-hidden />

        <div
          data-role="sizeall"
          className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5"
        >
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="ml-2 text-[0.65rem] tracking-widest text-faint uppercase">
            Testveld — sleep mij
          </span>
          <button
            type="button"
            data-role="help"
            className="ml-auto grid size-6 place-items-center rounded-full border border-white/10 text-xs text-muted"
            aria-label="Hulp"
          >
            ?
          </button>
        </div>

        <div className="grid gap-4 p-4 sm:p-5">
          <div>
            <h3 className="font-display text-2xl leading-tight font-bold">Beweeg overal.</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Dit is je cursor op echte grootte. Ga over{" "}
              <a
                href="#test"
                onClick={(e) => e.preventDefault()}
                className="text-accent underline underline-offset-4"
              >
                een link
              </a>
              , de randen van dit venster of de vlakken hieronder.
            </p>
          </div>

          <input
            aria-label="Typveld"
            placeholder="Typ hier iets…"
            className="glass-input min-h-11 w-full px-3 text-sm"
          />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Zone role="wait" title="Bezet" note="Even geduld" />
            <Zone role="appstarting" title="Laden" note="Op de achtergrond" />
            <Zone role="no" title="Op slot" note="Niet beschikbaar" />
            <Zone role="cross" title="Precisie" note="Raak het midden">
              <span className="absolute inset-0 grid place-items-center" aria-hidden>
                <span className="size-6 rounded-full border border-white/20" />
              </span>
            </Zone>
            <Zone role="nwpen" title="Tekenen" note="Schrijf met de pen" />
            <Zone role="up" title="Alternatief" note="Tweede selectie" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Zone({
  role,
  title,
  note,
  children,
}: {
  role: RoleId;
  title: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <div data-role={role} className="zone relative min-h-20 p-3">
      {children}
      <p className="relative text-xs font-medium tracking-widest uppercase">{title}</p>
      <p className="relative mt-1 text-[0.65rem] text-faint">{note}</p>
    </div>
  );
}

function Segment<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; name: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-[0.65rem] tracking-widest text-muted uppercase">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const on = option.id === value;
          return (
            <button
              key={String(option.id)}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.id)}
              className={clsx(
                "seg min-h-9 px-2.5 text-[0.7rem] tracking-wide uppercase",
                on && "is-on",
              )}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display?: string;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="grid">
      <span className="flex items-center justify-between text-[0.65rem] tracking-widest text-muted uppercase">
        {label}
        <span className="text-fg tabular-nums">{display ?? value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        aria-valuetext={display ?? String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function HotspotPad({
  src,
  image,
  hx,
  hy,
  onPick,
}: {
  src: string;
  image: Rgba;
  hx: number;
  hy: number;
  onPick: (x: number, y: number) => void;
}) {
  const left = ((hx + 0.5) / image.width) * 100;
  const top = ((hy + 0.5) / image.height) * 100;
  return (
    <div className="relative">
      <img
        src={src}
        alt=""
        draggable={false}
        className="pixelated block h-auto w-full"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          onPick(
            clamp(
              Math.floor(((e.clientX - rect.left) / rect.width) * image.width),
              0,
              image.width - 1,
            ),
            clamp(
              Math.floor(((e.clientY - rect.top) / rect.height) * image.height),
              0,
              image.height - 1,
            ),
          );
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${left}%`, top: `${top}%` }}
      >
        <span className="absolute top-1/2 left-0 h-px w-full bg-accent shadow-[0_0_6px_var(--color-accent)]" />
        <span className="absolute top-0 left-1/2 h-full w-px bg-accent shadow-[0_0_6px_var(--color-accent)]" />
      </span>
    </div>
  );
}

function FollowCursor({
  src,
  width,
  height,
  hx,
  hy,
  visible,
  pressed,
}: {
  src?: string;
  width: number;
  height: number;
  hx: number;
  hy: number;
  visible: boolean;
  pressed: boolean;
}) {
  const ref = useRef<HTMLImageElement | null>(null);
  const pos = useRef({ x: -999, y: -999 });
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el) el.style.transform = `translate3d(${pos.current.x - hx}px, ${pos.current.y - hy}px, 0)`;
    const onMove = (event: PointerEvent) => {
      pos.current = { x: event.clientX, y: event.clientY };
      const node = ref.current;
      if (node)
        node.style.transform = `translate3d(${event.clientX - hx}px, ${event.clientY - hy}px, 0)`;
      setMoved(true);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [hx, hy, src]);

  if (!src || width <= 0) return null;
  return (
    <img
      ref={ref}
      src={src}
      alt=""
      width={width}
      height={height}
      draggable={false}
      aria-hidden
      className={clsx(
        "pixelated pointer-events-none fixed top-0 left-0 z-50",
        visible && moved ? "opacity-100" : "opacity-0",
        pressed && "is-pressed",
      )}
    />
  );
}
