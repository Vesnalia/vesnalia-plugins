import { PALETTES, type GlassConfig } from "./config";

// Converts any CSS colour the browser understands into sRGB bytes.
//
// VesnALIA's theme is authored in oklch (`--canvas: oklch(19.5% 0 0)`), and modern
// Chrome reports `getComputedStyle().color` back in the *same* colour space
// rather than normalising to rgb(). Scraping digits out of that string reads
// lightness/chroma/hue as if they were R/G/B — oklch(0.195 0 0) becomes
// rgb(195,0,0), a bright red, which is why every surface turned red regardless
// of the theme picked (neutral themes are all `oklch(L 0 0)`).
//
// Painting the colour onto a 1x1 canvas and reading the pixel back delegates
// the conversion to the browser, so it stays correct for oklch, color(),
// hsl(), named colours and whatever ships next.
let colourProbe: CanvasRenderingContext2D | null | undefined;

function cssColourToRgb(value: string): [number, number, number] | null {
  if (!value) return null;

  // Fast path: legacy rgb()/rgba(), still what most browsers return.
  const legacy = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (legacy) {
    return [Math.round(+legacy[1]), Math.round(+legacy[2]), Math.round(+legacy[3])];
  }

  try {
    if (colourProbe === undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      colourProbe = canvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = colourProbe;
    if (!ctx) return null;

    // Two sentinels distinguish an invalid assignment from valid black,
    // including modern color-space representations of black.
    ctx.fillStyle = "#000000";
    ctx.fillStyle = value;
    if (ctx.fillStyle === "#000000") {
      ctx.fillStyle = "#ffffff";
      ctx.fillStyle = value;
      if (ctx.fillStyle === "#ffffff") return null;
    }

    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null; // fully transparent tells us nothing useful
    return [r, g, b];
  } catch {
    return null; // canvas unavailable or tainted
  }
}

export function rgbOf(varName: string, fallback: [number, number, number]) {
  const el = document.createElement("span");
  el.style.position = "absolute";
  el.style.visibility = "hidden";
  el.style.color = `var(${varName})`;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  el.remove();
  return (cssColourToRgb(computed) ?? fallback) as readonly [number, number, number];
}


export function resolvePalette(config: GlassConfig, accent: readonly [number, number, number]): [number, number, number][] {
  const colors = config.palette === 'custom' ? config.colors : PALETTES[config.palette].colors;
  return colors.map((value, index) => config.palette === 'theme' && index === 0 ? [...accent] : [parseInt(value.slice(1,3),16), parseInt(value.slice(3,5),16), parseInt(value.slice(5,7),16)]);
}
