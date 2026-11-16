// The bundled DOM lib declares the CSS Custom Highlight API types but omits
// their setlike/maplike members. Chromium (Electron 41) implements them.
interface Highlight {
  add(range: AbstractRange): this;
  clear(): void;
  delete(range: AbstractRange): boolean;
  has(range: AbstractRange): boolean;
  readonly size: number;
}

interface HighlightRegistry {
  set(name: string, highlight: Highlight): this;
  get(name: string): Highlight | undefined;
  has(name: string): boolean;
  delete(name: string): boolean;
  clear(): void;
  readonly size: number;
}
