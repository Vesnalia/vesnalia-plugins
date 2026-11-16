import type { GlassConfig } from "./config";

export const SHADER_OPTIONS = [
  { id: "flow", name: "Flow", description: "Soft fields of moving color" },
  { id: "aurora", name: "Aurora", description: "Light drifting across the horizon" },
  { id: "nebula", name: "Nebula", description: "Slow clouds with a little depth" },
  { id: "waves", name: "Waves", description: "Wide, layered waves" },
  { id: "silk", name: "Silk", description: "Quiet ribbons of reflected light" },
  { id: "contours", name: "Contours", description: "A landscape drawn in fine lines" },
] as const;
export function isShaderStyle(style: GlassConfig["style"]) { return style === "custom" || SHADER_OPTIONS.some((item) => item.id === style); }

export const STARTER_SHADER = `// Colors follow the palette you choose in Look.
void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float wave = sin(uv.x * 6.0 + iTime * 0.15);
  float blend = smoothstep(0.0, 1.0,
    uv.y + wave * 0.18);
  vec3 tint = mix(uColorA, uColorB, blend);
  tint = mix(tint, uColorC, uv.x * 0.25);
  color = vec4(tint * 0.55, 1.0);
}`;

export function shaderFragment(config: GlassConfig): string {
  if (config.style !== "custom") return BUILTIN_FRAGMENT;
  const shader = config.customShaders.find((item) => item.id === config.activeShaderId);
  if (!shader) throw new Error("This shader is no longer in your library. Choose another backdrop.");
  return `precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
#line 1
${shader.source}
void main() { vec4 color = vec4(0.0); mainImage(color, gl_FragCoord.xy); gl_FragColor = vec4(color.rgb, 1.0); }`;
}

export const BUILTIN_FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uStyle; // 0 flow, 1 aurora, 2 nebula, 3 waves
uniform vec3 uC0; // theme accent
uniform vec3 uC1; // sky
uniform vec3 uC2; // violet
uniform vec3 uBase;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x),
             mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime;
  vec3 col = uBase;

  if (uStyle < 0.5) {
    // FLOW — moving mesh gradient
    float n1 = fbm(p * 1.4 + vec2(t * 0.06, -t * 0.045));
    float n2 = fbm(p * 2.1 + vec2(-t * 0.05, t * 0.07) + 4.7);
    float n3 = fbm(p * 1.1 + vec2(t * 0.03, t * 0.02) + 9.2);
    col = mix(uBase, uC0, smoothstep(0.25, 0.85, n1));
    col = mix(col, uC1, smoothstep(0.45, 0.95, n2) * 0.75);
    col = mix(col, uC2, smoothstep(0.55, 1.0, n3) * 0.6);
  } else if (uStyle < 1.5) {
    // AURORA — flowing curtains
    float w1 = fbm(vec2(p.x * 1.6 + t * 0.1, t * 0.05));
    float w2 = fbm(vec2(p.x * 2.3 - t * 0.08, 7.0 + t * 0.04));
    float y1 = 0.62 + 0.18 * (w1 - 0.5) * 2.0;
    float y2 = 0.42 + 0.22 * (w2 - 0.5) * 2.0;
    float b1 = exp(-pow((uv.y - y1) * 4.4, 2.0));
    float b2 = exp(-pow((uv.y - y2) * 3.6, 2.0));
    col += uC0 * b1 * (0.55 + 0.45 * w1);
    col += mix(uC1, uC2, w2) * b2 * 0.5;
    col += uC2 * exp(-pow((uv.y - 0.85) * 5.0, 2.0)) * 0.25 * w1;
  } else if (uStyle < 2.5) {
    // NEBULA — swirling clouds
    vec2 c = p - vec2(0.5 * uRes.x / uRes.y, 0.5);
    float ang = fbm(p * 1.5 + t * 0.02) * 6.2831;
    vec2 q = c + 0.28 * vec2(cos(ang), sin(ang));
    float d1 = fbm(q * 2.0 + t * 0.03);
    float d2 = fbm(q * 3.4 - t * 0.02 + 5.0);
    col = mix(uBase, uC2, smoothstep(0.3, 0.9, d1));
    col = mix(col, uC0, smoothstep(0.5, 1.0, d2) * 0.7);
    col = mix(col, uC1, smoothstep(0.62, 1.0, fbm(q * 5.0 + 11.0)) * 0.4);
  } else if (uStyle < 3.5) {
    // WAVES — layered sine bands
    float s1 = sin(p.x * 4.0 + t * 0.35 + sin(t * 0.11) * 2.0);
    float s2 = sin(p.x * 6.5 - t * 0.28 + 1.7);
    float y1 = 0.55 + 0.1 * s1;
    float y2 = 0.35 + 0.08 * s2;
    col = mix(uBase, uC0 * 0.85, smoothstep(y1 + 0.25, y1 - 0.3, uv.y));
    col = mix(col, uC1 * 0.8, smoothstep(y2 + 0.2, y2 - 0.28, uv.y) * 0.8);
    col += uC2 * 0.14 * (0.5 + 0.5 * sin(p.x * 2.0 + t * 0.2 + 3.0));
  }

  if (uStyle > 3.5 && uStyle < 4.5) {
    // SILK — wide, folded ribbons.
    float fold = sin(p.x * 3.6 + p.y * 2.4 + sin(p.y * 2.8 - t * .12) * 1.6);
    float light = pow(.5 + .5 * fold, 2.2);
    col = mix(uBase, uC0 * .65, light);
    col = mix(col, uC1, pow(.5 + .5 * sin(fold * 2.5 + p.y * 2.0), 7.0) * .48);
    col += uC2 * (.5 + .5 * sin(p.x * 2. + t * .08)) * .15;
  } else if (uStyle > 4.5) {
    // CONTOURS — slowly moving topographic lines.
    float height = fbm(p * 1.5 + vec2(t * .018, t * -.012));
    float bands = .5 + .5 * cos(height * 58.);
    float contour = pow(bands, 16.0);
    col = mix(uBase, uC0 * .58, height);
    col += mix(uC1, uC2, height) * contour * .32;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
