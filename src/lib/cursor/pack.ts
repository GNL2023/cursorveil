import { encodeAni, encodeCur, zipStore } from "@/lib/cursor/encode";
import type { Rgba } from "@/lib/cursor/types";

function pngBytes(frame: Rgba) {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas ontbreekt");
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height),
    0,
    0,
  );
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("PNG mislukt"));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function text(value: string) {
  return new TextEncoder().encode(value);
}

export async function buildScheme(opts: {
  name: string;
  title: string;
  fps: number;
  roles: {
    file: string;
    label: string;
    windows: string;
    frames: Rgba[];
    hx: number;
    hy: number;
    animate: boolean;
  }[];
}) {
  const slug =
    opts.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "lucent-pack";
  const title = opts.title.replace(/[^\w .+-]/g, "").trim() || "LUCENT";
  const arrow = opts.roles[0];
  const pngs = await Promise.all(arrow.frames.map((frame) => pngBytes(frame)));
  const stills = await Promise.all(opts.roles.map((role) => pngBytes(role.frames[0])));
  const files = opts.roles.map(
    (role) => `${role.file}${role.animate && role.frames.length > 1 ? ".ani" : ".cur"}`,
  );
  const scheme = files.map((file) => `%10%\\%CUR_DIR%\\${file}`).join(",");
  const copyList = files.join("\r\n");
  const inf = `[Version]
signature="$CHICAGO$"

[DefaultInstall]
CopyFiles = Scheme.Cur
AddReg    = Scheme.Reg

[DestinationDirs]
Scheme.Cur = 10,"%CUR_DIR%"

[Scheme.Reg]
HKCU,"Control Panel\\Cursors\\Schemes","%SCHEME_NAME%",,"${scheme}"

[Scheme.Cur]
${copyList}

[Strings]
CUR_DIR = "Cursors\\LUCENT-${slug}"
SCHEME_NAME = "LUCENT ${title}"
`;
  const lines = opts.roles.map((role, i) => `${role.windows} — ${files[i]}`).join("\r\n");
  const readme = `LUCENT — ${title}
Volledig aanwijzerschema. ${opts.roles.length} cursors, ${arrow.frames[0].width}×${arrow.frames[0].height}, ${opts.fps} fps op de bewegende aanwijzers.

Installeren
1. Pak deze map uit.
2. Rechtermuisklik op install.inf en kies Installeren.
3. Instellingen, Bluetooth en apparaten, Muis, Aanvullende muisinstellingen.
4. Tab Aanwijzers. Kies het schema LUCENT ${title}.

Lukt install.inf niet, kies bij elke regel Bladeren en wijs het bestand aan:

${lines}

Browser
Open web/preview.html. Elk vak toont zijn eigen aanwijzer.
Wil je ze op je eigen site? Kopieer web/cursor.css, web/cursor.js en de mappen png/ en web/frames/.
`;
  const frameList = pngs.map((_, i) => `./frames/${String(i).padStart(2, "0")}.png`);
  // Real CSS cursors for every role (browsers accept PNG up to 128 px). The arrow
  // is animated by swapping its frame on <html>; elements with their own cursor keep it.
  const cssFor = (i: number, fallback: string) =>
    `url("../png/${opts.roles[i].file}.png") ${Math.round(opts.roles[i].hx)} ${Math.round(opts.roles[i].hy)}, ${fallback}`;
  const fallbacks: Record<string, string> = {
    arrow: "default",
    help: "help",
    appstarting: "progress",
    wait: "wait",
    cross: "crosshair",
    ibeam: "text",
    nwpen: "crosshair",
    no: "not-allowed",
    sizens: "ns-resize",
    sizewe: "ew-resize",
    sizenwse: "nwse-resize",
    sizenesw: "nesw-resize",
    sizeall: "move",
    up: "default",
    hand: "pointer",
  };
  const rules = opts.roles
    .map(
      (role, i) =>
        `[data-cursor="${role.file}"] { cursor: ${cssFor(i, fallbacks[role.file] ?? "default")}; }`,
    )
    .join("\n");
  const css = `html { cursor: ${cssFor(0, "default")}; }
a, button, label { cursor: ${cssFor(
    Math.max(
      0,
      opts.roles.findIndex((r) => r.file === "hand"),
    ),
    "pointer",
  )}; }
input, textarea { cursor: ${cssFor(
    Math.max(
      0,
      opts.roles.findIndex((r) => r.file === "ibeam"),
    ),
    "text",
  )}; }
${rules}
`;
  const js = `(() => {
  const frames = ${JSON.stringify(frameList)};
  if (frames.length < 2) return;
  const fps = ${opts.fps};
  const hot = "${Math.round(arrow.hx)} ${Math.round(arrow.hy)}";
  frames.forEach((src) => { const img = new Image(); img.src = src; });
  let i = 0;
  setInterval(() => {
    i = (i + 1) % frames.length;
    document.documentElement.style.cursor = 'url("' + frames[i] + '") ' + hot + ", default";
  }, Math.round(1000 / Math.max(1, fps)));
})();
`;
  const list = opts.roles
    .map(
      (role, i) =>
        `<li data-cursor="${role.file}"><b>${role.label}</b> ${role.windows} <span>${files[i]}</span></li>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — LUCENT</title>
  <link rel="stylesheet" href="./cursor.css" />
  <style>
    body { margin: 0; min-height: 100vh; background: radial-gradient(60rem 40rem at 80% -10%, #12303a, transparent 60%), #07080c; color: #e7eef4; font: 15px/1.5 "IBM Plex Mono", ui-monospace, monospace; }
    main { max-width: 44rem; margin: 0 auto; padding: 4rem 1.25rem 6rem; }
    ul { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.5rem; }
    li { border: 1px solid #2a3340; border-radius: 10px; padding: 1rem; min-height: 4rem; }
    li:hover { border-color: #9ee7ff; background: #0f1a20; }
    b { display: block; font-weight: 500; }
    span { color: #93a0ae; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <p>LUCENT</p>
    <h1>${title}</h1>
    <p>Beweeg over de vakken: elk vak toont zijn eigen aanwijzer, de pijl beweegt. Windows krijgt het hele schema via install.inf.</p>
    <ul>${list}</ul>
  </main>
  <script src="./cursor.js"></script>
</body>
</html>
`;
  const root = slug;
  const entries = [
    { name: `${root}/install.inf`, data: text(inf) },
    { name: `${root}/LEESMIJ.txt`, data: text(readme) },
    { name: `${root}/web/preview.html`, data: text(html) },
    { name: `${root}/web/cursor.js`, data: text(js) },
    { name: `${root}/web/cursor.css`, data: text(css) },
    ...opts.roles.map((role, i) => {
      const animated = role.animate && role.frames.length > 1;
      const data = animated
        ? encodeAni(role.frames, role.hx, role.hy, opts.fps, `${title} ${role.file}`)
        : encodeCur(role.frames[0], role.hx, role.hy);
      return { name: `${root}/${files[i]}`, data };
    }),
    ...stills.map((data, i) => ({ name: `${root}/png/${opts.roles[i].file}.png`, data })),
    ...pngs.map((data, i) => ({
      name: `${root}/web/frames/${String(i).padStart(2, "0")}.png`,
      data,
    })),
  ];
  return { slug, bytes: zipStore(entries) };
}

export async function framePng(frame: Rgba) {
  return pngBytes(frame);
}
