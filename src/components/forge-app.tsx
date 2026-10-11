export function ForgeApp() {
  const [settings, setSettings] = useState<ForgeSettings>(DEFAULT_SETTINGS);
  const [packName, setPackName] = useState("etherpijl");
  const [theme, setTheme] = useState<ThemeId>("ether");
  const [role, setRole] = useState<RoleId>("arrow");
  const [hoverRole, setHoverRole] = useState<RoleId | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<ThemeId, Rgba>>>({});
  const [overrides, setOverrides] = useState<Partial<Record<ThemeId, Partial<Record<RoleId, Rgba[]>>>>>({});
  const [manuals, setManuals] = useState<Partial<Record<string, { x: number; y: number }>>>({});
  const [playing, setPlaying] = useState(true);
  const [playFrame, setPlayFrame] = useState(0);
  const [scrub, setScrub] = useState(0);
  const [compare, setCompare] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  const [overStage, setOverStage] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Pack tekenen");
  const [ready, setReady] = useState(false);
  const uploadRef = useRef<ImageBitmap[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          settings?: Partial<ForgeSettings>;
          packName?: string;
          theme?: ThemeId;
          role?: RoleId;
          manuals?: Partial<Record<string, { x: number; y: number }>>;
        };
        setSettings((current) => sanitize(current, parsed.settings));
        if (typeof parsed.packName === "string" && parsed.packName.trim()) setPackName(parsed.packName.slice(0, 40));
        if (isTheme(parsed.theme)) setTheme(parsed.theme);
        if (isRole(parsed.role)) setRole(parsed.role);
        if (parsed.manuals && typeof parsed.manuals === "object") {
          const next: Partial<Record<string, { x: number; y: number }>> = {};
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
    localStorage.setItem(STORAGE, JSON.stringify({ settings, packName, theme, role, manuals }));
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
            return [item.id, rgba] as const;
          }),
        );
        if (cancel) return;
        setPhotos(Object.fromEntries(loaded) as Partial<Record<ThemeId, Rgba>>);
        setStatus("Vijftien aanwijzers. Sleep over de vlakken, of kies er een links.");
      } catch {
        if (!cancel) setStatus("Bronnen konden niet laden. De sjablonen blijven staan.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      uploadRef.current?.forEach((bitmap) => bitmap.close());
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.code !== "Space") return;
      event.preventDefault();
      setPlaying((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    const map = {} as Record<RoleId, { frames: Rgba[]; hx: number; hy: number }>;
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

  const themeMeta = THEMES.find((item) => item.id === theme) ?? THEMES[0];
  const pinned = ROLES.find((item) => item.id === role) ?? ROLES[0];
  const liveId = hoverRole ?? role;
  const liveMeta = ROLES.find((item) => item.id === liveId) ?? pinned;
  const pinnedFrames = rendered[role].frames;
  const liveFrames = rendered[liveId].frames;

  useEffect(() => {
    if (!playing || pinnedFrames.length < 2) return;
    let raf = 0;
    const start = performance.now();
    const loop = (time: number) => {
      const next = Math.floor(((time - start) / 1000) * settings.fps) % pinnedFrames.length;
      setPlayFrame((prev) => (prev === next ? prev : next));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, pinnedFrames.length, settings.fps]);

  const safeIndex = pinnedFrames.length ? (playing ? playFrame : scrub) % pinnedFrames.length : 0;
  const liveIndex = liveFrames.length ? (playing ? playFrame : scrub) % liveFrames.length : 0;
  const pinnedSources = glyphs[role].frames;
  const cleanFrames = useMemo(
    () => (compare && pinnedSources.length ? [renderClean(pinnedSources, settings.size, safeIndex)] : []),
    [compare, pinnedSources, settings.size, safeIndex],
  );

  function chooseTheme(next: ThemeId) {
    const meta = THEMES.find((item) => item.id === next);
    if (!meta) return;
    setTheme(next);
    setRole("arrow");
    setHoverRole(null);
    setPackName(meta.pack);
    setSettings((current) => ({ ...current, ...meta.settings }));
    setStatus(`${meta.name}. Vijftien aanwijzers, van pijl tot I-balk.`);
  }

  async function ingest(list: FileList | File[]) {
    const images = [...list].filter((file) => file.type.startsWith("image/")).sort((a, b) => a.name.localeCompare(b.name, "nl"));
    if (!images.length) {
      setStatus("Alleen PNG, WebP of GIF.");
      return;
    }
    const next: ImageBitmap[] = [];
    for (const file of images) next.push(await createImageBitmap(file));
    uploadRef.current?.forEach((bitmap) => bitmap.close());
    uploadRef.current = next;
    const frames = next.map((bitmap) => bitmapToRgba(bitmap));
    setOverrides((current) => ({
      ...current,
      [theme]: { ...current[theme], [role]: frames },
    }));
    setManuals((current) => {
      const copy = { ...current };
      delete copy[`${theme}:${role}`];
      return copy;
    });
    const label = images.length > 1 ? `${images.length} frames` : images[0].name.replace(/\.[^.]+$/, "");
    setStatus(`${pinned.label} vervangen door ${label}.`);
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
    setStatus(`${pinned.label} staat weer op het sjabloon.`);
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
    const frame = pinnedFrames[safeIndex];
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

  const shellCursor = fullPage ? "cursor-test" : undefined;
  const frameUrls = useFrameUrls(pinnedFrames);
  const cleanUrls = useFrameUrls(cleanFrames);
  const loupeSrc = compare ? cleanUrls[0] : frameUrls[safeIndex];
  const loupeImage = compare ? cleanFrames[0] : pinnedFrames[safeIndex];
  const loupeHot = rendered[role];
  const thumbFrames = useMemo(() => ROLES.map((item) => rendered[item.id].frames[0]), [rendered]);
  const thumbUrls = useFrameUrls(thumbFrames);
  const liveUrls = useFrameUrls(liveFrames);
  const liveSrc = liveUrls[liveIndex];
  const liveHot = rendered[liveId];
  const replaced = Boolean(overrides[theme]?.[role]);

  return (