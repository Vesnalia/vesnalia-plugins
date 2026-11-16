import { z } from "zod";

// Remote images are fetched by each user's browser. Keep the accepted format
// explicit and bounded; never interpret a pasted URL as arbitrary CSS.
export function isWallpaperUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}
export const wallpaperUrlSchema = z.string().trim().max(4096).refine(isWallpaperUrl, {
  message: "Use a complete HTTP or HTTPS image URL without embedded credentials.",
});

export const STYLES = [
  "flow",
  "aurora",
  "nebula",
  "waves",
  "silk",
  "contours",
  "custom",
  "glow",
  "image",
  "none",
] as const;

export const MAX_SHADERS = 8;
export const shaderSourceSchema = z.string().trim().min(1).max(16_384)
  .refine((source) => new TextEncoder().encode(source).length <= 24_576, "Shader code must be under 24 KB.")
  .refine((source) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source), "Remove control characters from the shader.")
  .refine((source) => /\bvoid\s+mainImage\s*\(/.test(source), "Include void mainImage(out vec4 color, in vec2 fragCoord).")
  .refine((source) => !/^\s*#\s*(?:version|include)\b/m.test(source), "Use GLSL ES 1.00 without #version or external includes.");
export const shaderSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(60),
  source: shaderSourceSchema,
}).strict();
export type CustomShader = z.infer<typeof shaderSchema>;
export const shaderLibrarySchema = z.array(shaderSchema).max(MAX_SHADERS)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Shader IDs must be unique.")
  .refine((items) => new TextEncoder().encode(JSON.stringify(items)).length <= 150_000, "The shader library is full. Remove a shader before adding more.");
export const PALETTES = {
  theme: { name: "VesnALIA theme", colors: ["#8b91e8", "#38adf0", "#b88cf5"] },
  cobalt: { name: "Cobalt", colors: ["#567af2", "#63cad4", "#ac9bea"] },
  moss: { name: "Moss", colors: ["#789d71", "#b4c894", "#397d77"] },
  ember: { name: "Ember", colors: ["#dd8869", "#dab779", "#aa6684"] },
  dusk: { name: "Dusk", colors: ["#ba83b7", "#8394c8", "#dfad97"] },
} as const;

export const configSchema = z.object({
  enabled: z.boolean(),
  /** Surface opacity 55–100 (%). Lower = more see-through glass. */
  opacity: z.number().min(55).max(100),
  /** Backdrop blur radius 0–80 px (blurs the glow layer itself). */
  blur: z.number().min(0).max(80),
  /** Ambient backdrop style behind the UI. */
  style: z.enum(STYLES),
  /** Wallpaper URL when style = "image". */
  imageUrl: wallpaperUrlSchema,
  /** Slow ambient motion on the backdrop. */
  animate: z.boolean(),
  /** Darkening scrim 0–70 (%) for readability over bright backdrops. */
  dim: z.number().min(0).max(70),
  /** Film-grain overlay strength 0–40 (%). */
  grain: z.number().min(0).max(40),
  /** Animation speed 10–300 (%) for shader/ambient motion. */
  speed: z.number().min(10).max(300),
  /** Sidebar surface opacity 60–100 (%) — kept higher so its UI stays legible. */
  sidebarOpacity: z.number().min(60).max(100),
  /** Sidebar frost: backdrop blur 0–40 px applied to the sidebar itself. */
  sidebarBlur: z.number().min(0).max(40),
  /** Chat-input frost: backdrop blur 0–40 px behind the composer. */
  composerBlur: z.number().min(0).max(40),
  /** Master switch for the chat-input frost region (off = stock composer). */
  composerFrost: z.boolean(),
  /** Frost dialogs / popovers / menus (off = near-opaque stock surfaces). */
  modalFrost: z.boolean(),
  /** Modal & menu backdrop blur 0–40 px. */
  modalBlur: z.number().min(0).max(40),
  palette: z.enum(["theme", "cobalt", "moss", "ember", "dusk", "custom"]),
  colors: z.tuple([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  quality: z.enum(["low", "balanced", "high"]),
  activeShaderId: z.string().max(64),
  customShaders: shaderLibrarySchema,
});
export type GlassConfig = z.infer<typeof configSchema>;
export const configPatchSchema = configSchema.omit({ customShaders: true }).partial().strict();

export const DEFAULT_CONFIG: GlassConfig = {
  enabled: false,
  opacity: 82,
  blur: 44,
  style: "flow",
  imageUrl: "",
  animate: true,
  dim: 30,
  grain: 12,
  speed: 100,
  sidebarOpacity: 94,
  sidebarBlur: 18,
  composerBlur: 24,
  composerFrost: true,
  modalFrost: true,
  modalBlur: 20,
  palette: "theme",
  colors: ["#8b91e8", "#38adf0", "#b88cf5"],
  quality: "balanced",
  activeShaderId: "",
  customShaders: [],
};

// Recover fields independently so one old or invalid value never discards
// unrelated preferences. Reading does not overwrite the stored record.
export function readStoredConfig(stored: unknown): GlassConfig {
  const source = stored && typeof stored === "object" && !Array.isArray(stored)
    ? stored as Record<string, unknown> : {};
  const config = Object.fromEntries(Object.entries(configSchema.shape).map(([key, schema]) => {
    const parsed = schema.safeParse(source[key]);
    return [key, parsed.success ? parsed.data : DEFAULT_CONFIG[key as keyof GlassConfig]];
  })) as GlassConfig;
  if (config.style === "custom" && !config.customShaders.some((shader) => shader.id === config.activeShaderId)) {
    config.style = "flow"; config.activeShaderId = "";
  }
  return config;
}
