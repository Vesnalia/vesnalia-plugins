import { useEffect, useMemo, useRef, useState } from "react";
import { useGlassConfig } from "./use-glass-config";
import { MAX_SHADERS, PALETTES, shaderSchema, wallpaperUrlSchema, type CustomShader, type GlassConfig } from "./config";
import { GlassIcon } from "./icon";
import { Artwork, WorkspacePreview } from "./preview";
import { isShaderStyle, SHADER_OPTIONS, STARTER_SHADER } from "./shaders";

function Slider({ label, value, min, max, unit, onChange, disabled = false }: {
  label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void; disabled?: boolean;
}) {
  return <label className="glass-slider"><span><span>{label}</span><output>{value}{unit}</output></span>
    <input type="range" min={min} max={max} value={value} disabled={disabled} aria-label={label} aria-valuetext={`${value}${unit}`} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}
function Toggle({ label, hint, checked, onChange, disabled = false }: {
  label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  return <label className="glass-toggle"><span><span className="glass-control-label">{label}</span>{hint && <span className="glass-hint">{hint}</span>}</span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}
const TABS = ["Look", "Surfaces", "Motion", "Shader"] as const;
type Tab = typeof TABS[number];
const OTHER_STYLES = [{ id: "glow", label: "Glow" }, { id: "image", label: "Image" }, { id: "none", label: "Plain" }] as const;

export function GlassPanel() {
  const { config: cfg, error, saving, update, reset, retry, saveShader, deleteShader } = useGlassConfig();
  const [tab, setTab] = useState<Tab>("Look");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [wallpaper, setWallpaper] = useState("");
  const [wallpaperDirty, setWallpaperDirty] = useState(false);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [compact, setCompact] = useState(false);
  const [shaderId, setShaderId] = useState("");
  const [shaderName, setShaderName] = useState("My shader");
  const [source, setSource] = useState(STARTER_SHADER);
  const [draft, setDraft] = useState<CustomShader | null>(null);
  const [validated, setValidated] = useState<string | null>(null);
  const [shaderError, setShaderError] = useState<string | null>(null);
  const [graphicsError, setGraphicsError] = useState<string | null>(null);
  const [shaderStatus, setShaderStatus] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const importer = useRef<HTMLInputElement>(null);
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)"), size = matchMedia("(max-width: 767.98px)");
    const sync = () => { setReducedMotion(motion.matches); setCompact(size.matches); };
    sync(); motion.addEventListener("change", sync); size.addEventListener("change", sync);
    return () => { motion.removeEventListener("change", sync); size.removeEventListener("change", sync); };
  }, []);
  useEffect(() => { if (!wallpaperDirty) setWallpaper(cfg?.imageUrl ?? ""); }, [cfg?.imageUrl, wallpaperDirty]);
  useEffect(() => setImageFailed(false), [cfg?.imageUrl]);
  const previewConfig = useMemo(() => cfg && draft ? { ...cfg, style: "custom" as const, activeShaderId: draft.id, customShaders: [draft] } : cfg, [cfg, draft]);
  // Thumbnails are still images. Rebuild only when their palette changes.
  const thumbnails = useMemo(() => cfg ? SHADER_OPTIONS.map((item) => ({ ...cfg, style: item.id, animate: false })) : [], [cfg?.palette, cfg?.colors]);
  const shaderParsed = shaderSchema.safeParse({ id: shaderId || "draft", name: shaderName, source });
  const libraryFull = !!cfg && !shaderId && cfg.customShaders.length >= MAX_SHADERS;
  const applyWallpaper = () => {
    const parsed = wallpaperUrlSchema.safeParse(wallpaper);
    if (!parsed.success) { setWallpaperError("Enter a complete HTTP or HTTPS image URL, up to 4,096 characters, without embedded credentials."); return; }
    setWallpaperError(null); setWallpaperDirty(false); update({ imageUrl: parsed.data });
  };
  const editShader = (shader?: CustomShader) => {
    setShaderId(shader?.id ?? ""); setShaderName(shader?.name ?? "My shader"); setSource(shader?.source ?? STARTER_SHADER);
    setDraft(null); setValidated(null); setShaderError(null); setShaderStatus(""); setTab("Shader");
    requestAnimationFrame(() => { inspector.current?.scrollIntoView?.({ block: "nearest" }); inspector.current?.querySelector<HTMLInputElement>("#glass-shader-name")?.focus(); });
  };
  const previewShader = () => {
    setShaderStatus(""); setValidated(null);
    if (!shaderParsed.success) { setShaderError(shaderParsed.error.issues[0]?.message ?? "Check the shader code."); return; }
    setShaderError(null); setDraft({ ...shaderParsed.data });
  };
  const doSaveShader = async () => {
    if (!shaderParsed.success || validated !== source.trim() || libraryFull) return;
    const shader = { ...shaderParsed.data, id: shaderId || `shader-${crypto.randomUUID()}` };
    if (await saveShader(shader)) { setShaderId(shader.id); setDraft(null); setShaderStatus(`“${shader.name}” saved and selected.`); }
  };
  const importShader = async (file: File | undefined) => {
    if (!file) return;
    setShaderError(null); setValidated(null); setShaderStatus("");
    try {
      if (file.size > 40_000) throw new Error("Choose a shader file under 40 KB.");
      const text = await file.text();
      let name = file.name.replace(/\.(?:glsl|frag|json)$/i, "").slice(0, 60), code = text;
      if (/\.json$/i.test(file.name)) {
        const data: unknown = JSON.parse(text);
        if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1 || !("name" in data) || typeof data.name !== "string" || !("source" in data) || typeof data.source !== "string") throw new Error("Use a Transparency shader export (version 1, name, source).");
        name = data.name; code = data.source;
      }
      const parsed = shaderSchema.safeParse({ id: "draft", name, source: code });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid shader file.");
      setShaderId(""); setShaderName(parsed.data.name); setSource(parsed.data.source); setDraft(null);
      setShaderStatus("Imported. Preview the shader before saving.");
    } catch (error) { setShaderError(error instanceof Error ? error.message : "Couldn’t read this shader file."); }
    finally { if (importer.current) importer.current.value = ""; }
  };
  const exportShader = () => {
    if (!shaderParsed.success) return;
    const blob = new Blob([JSON.stringify({ version: 1, name: shaderParsed.data.name, source: shaderParsed.data.source }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${shaderParsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "shader"}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const selectStyle = (style: GlassConfig["style"]) => { setDraft(null); setValidated(null); update({ style }); if (style === "image") setTab("Look"); };
  const doReset = async () => {
    setResetting(true);
    if (await reset()) { setConfirmReset(false); setWallpaperDirty(false); setWallpaperError(null); setDraft(null); setValidated(null); }
    setResetting(false);
  };
  if (!cfg || !previewConfig) return <div className="glass-panel"><div className="glass-load" role={error ? "alert" : "status"}><p>{error ?? "Loading your settings…"}</p>{error && <button className="glass-button" onClick={() => void retry()}>Try again</button>}</div></div>;
  return <div className="glass-panel">
    <header className="glass-toolbar"><Toggle label="Enable transparency" hint={cfg.enabled ? compact ? "On · Compact screens keep solid surfaces." : "Your look is active across VesnALIA." : "Off · Explore and save your look below."} checked={cfg.enabled} disabled={resetting} onChange={(enabled) => update({ enabled })} />
      <span className="glass-status" role="status">{saving ? "Saving…" : error ? "Not saved" : "Changes saved"}</span></header>
    {error && <div className="glass-error" role="alert"><span>{error}</span><button className="glass-button" onClick={() => void retry()}>Retry</button></div>}
    <fieldset className="glass-settings" disabled={resetting}>
      <div className="glass-studio">
        <div className="glass-gallery">
          <WorkspacePreview config={previewConfig} draft={!!draft} onResult={(message) => {
            setGraphicsError(message);
            if (draft) { setShaderError(message); setValidated(message ? null : draft.source); }
          }} />
          <button className="glass-edit-look glass-text-button" type="button" onClick={() => { inspector.current?.scrollIntoView?.({ block: "start" }); inspector.current?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus(); }}>Edit appearance <GlassIcon name="down" /></button>
          {graphicsError && <p className="glass-field-error" role="status">{draft ? "This shader couldn’t render. Check the Shader tab for details." : graphicsError}</p>}
          <section className="glass-library"><div className="glass-section-heading"><h2>Backdrop library</h2><span className="glass-hint">Six shaders, your colors</span></div>
            <div className="glass-scenes" role="group" aria-label="Backdrop style">
              {SHADER_OPTIONS.map((item, index) => <button key={item.id} type="button" className="glass-scene" aria-pressed={cfg.style === item.id && !draft} onClick={() => selectStyle(item.id)} title={item.description}>
                <span className="glass-scene-image"><Artwork config={thumbnails[index]!} thumbnail /></span><span className="glass-scene-name">{item.name}<span className="glass-selection" aria-hidden="true">{cfg.style === item.id && !draft ? <GlassIcon name="check" /> : null}</span></span>
              </button>)}
            </div>
            <div className="glass-other-scenes" role="group" aria-label="Other backdrops">{OTHER_STYLES.map((item) => <button type="button" className="glass-button" key={item.id} aria-pressed={cfg.style === item.id && !draft} onClick={() => selectStyle(item.id)}>{item.label}</button>)}</div>
          </section>
          <section className="glass-custom-library"><div className="glass-section-heading"><h2>Your shaders <span className="glass-count">{cfg.customShaders.length}/{MAX_SHADERS}</span></h2><button className="glass-button" type="button" onClick={() => editShader()}>Add shader</button></div>
            {cfg.customShaders.length === 0 ? <p className="glass-hint">Bring your own GLSL shader or start with an editable example.</p> : <div className="glass-saved-list">{cfg.customShaders.map((shader) => <div key={shader.id} className="glass-saved-row">
              <button className="glass-saved-select" type="button" aria-pressed={cfg.style === "custom" && cfg.activeShaderId === shader.id && !draft} onClick={() => { setDraft(null); setValidated(null); update({ style: "custom", activeShaderId: shader.id }); }}><span>{shader.name}</span>{cfg.style === "custom" && cfg.activeShaderId === shader.id && <span className="glass-hint">Selected</span>}</button>
              <button type="button" className="glass-button" aria-label={`Edit ${shader.name}`} onClick={() => editShader(shader)}>Edit</button>
              <button type="button" className="glass-button" aria-label={`Remove ${shader.name}`} disabled={saving} onClick={() => setDeleteId(shader.id)}>Remove</button>
              {deleteId === shader.id && <div className="glass-delete-confirm"><p>Remove “{shader.name}”? {cfg.activeShaderId === shader.id ? "The backdrop will return to Flow." : "This removes its saved code."}</p><div className="glass-actions"><button type="button" className="glass-button glass-destructive" disabled={saving} onClick={async () => { if (await deleteShader(shader.id)) { setDeleteId(null); if (shaderId === shader.id) { setShaderId(""); setDraft(null); setValidated(null); } } }}>Remove shader</button><button type="button" className="glass-button" onClick={() => setDeleteId(null)}>Keep shader</button></div></div>}
            </div>)}</div>}
          </section>
        </div>
        <section className="glass-inspector" ref={inspector} aria-label="Appearance controls">
          <div className="glass-tabs" role="tablist" aria-label="Appearance settings">{TABS.map((name, index) => <button key={name} type="button" role="tab" id={`glass-tab-${name}`} aria-selected={tab === name} aria-controls="glass-inspector-body" tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); setTab(TABS[next]!); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); }
          }}>{name}</button>)}</div>
          <div className="glass-inspector-body" id="glass-inspector-body" role="tabpanel" aria-labelledby={`glass-tab-${tab}`}>
            {tab === "Look" && <>
              <div className="glass-field"><label className="glass-control-label" htmlFor="glass-palette">Color palette</label><select id="glass-palette" value={cfg.palette} onChange={(event) => update({ palette: event.target.value as GlassConfig["palette"] })}>{Object.entries(PALETTES).map(([id, palette]) => <option value={id} key={id}>{palette.name}</option>)}<option value="custom">Custom colors</option></select>
                <div className="glass-palette-colors">{(cfg.palette === "custom" ? cfg.colors : PALETTES[cfg.palette].colors).map((color, index) => cfg.palette === "custom" ? <label className="glass-color" key={index}><input type="color" value={color} aria-label={`Shader color ${index + 1}`} onChange={(event) => { const colors = [...cfg.colors] as GlassConfig["colors"]; colors[index] = event.target.value; update({ colors }); }} /><span>{color}</span></label> : <span key={index} style={{ background: color }} />)}</div>
              </div>
              {cfg.style === "image" && <div className="glass-field glass-wallpaper"><label className="glass-control-label" htmlFor="glass-wallpaper">Wallpaper URL</label><input id="glass-wallpaper" type="url" value={wallpaper} placeholder="https://example.com/wallpaper.jpg" aria-invalid={!!wallpaperError} aria-describedby="glass-url-help" onChange={(event) => { setWallpaper(event.target.value); setWallpaperDirty(true); setWallpaperError(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyWallpaper(); } }} /><button className="glass-button" type="button" disabled={!wallpaperDirty} onClick={applyWallpaper}>Apply image</button><p id="glass-url-help" className="glass-hint">Use a direct image URL. Images load from their original website. Clear the field and apply to remove it.</p>{wallpaperError && <p className="glass-field-error" role="alert">{wallpaperError}</p>}{cfg.imageUrl && <><img className="glass-wallpaper-check" src={cfg.imageUrl} alt="Wallpaper preview" onError={() => setImageFailed(true)} hidden={imageFailed} />{imageFailed && <p className="glass-field-error" role="status">This image couldn’t load. Check the URL and your connection.</p>}</>}</div>}
              <Slider label="Surface opacity" value={cfg.opacity} min={55} max={100} unit="%" onChange={(opacity) => update({ opacity })} />
              <Slider label="Backdrop blur" value={cfg.blur} min={0} max={80} unit="px" disabled={cfg.style === "image" || cfg.style === "none"} onChange={(blur) => update({ blur })} />
              <Slider label="Dimming" value={cfg.dim} min={0} max={70} unit="%" onChange={(dim) => update({ dim })} />
              <p className="glass-hint">Lower opacity reveals more of the backdrop. Small screens use solid surfaces so panels don’t overlap visually.</p>
            </>}
            {tab === "Surfaces" && <><p className="glass-hint">Fine-tune desktop surfaces. Compact layouts keep panels and navigation opaque.</p><Slider label="Sidebar opacity" value={cfg.sidebarOpacity} min={60} max={100} unit="%" onChange={(sidebarOpacity) => update({ sidebarOpacity })} /><Slider label="Sidebar frost" value={cfg.sidebarBlur} min={0} max={40} unit="px" onChange={(sidebarBlur) => update({ sidebarBlur })} /><div className="glass-divider" /><Toggle label="Frost chat input" checked={cfg.composerFrost} onChange={(composerFrost) => update({ composerFrost })} /><Slider label="Chat input blur" value={cfg.composerBlur} min={0} max={40} unit="px" disabled={!cfg.composerFrost} onChange={(composerBlur) => update({ composerBlur })} /><div className="glass-divider" /><Toggle label="Frost dialogs and popups" checked={cfg.modalFrost} onChange={(modalFrost) => update({ modalFrost })} /><Slider label="Dialog and popup blur" value={cfg.modalBlur} min={0} max={40} unit="px" disabled={!cfg.modalFrost} onChange={(modalBlur) => update({ modalBlur })} /></>}
            {tab === "Motion" && <><Toggle label="Ambient motion" checked={cfg.animate} hint={reducedMotion ? "Paused: your device prefers reduced motion." : "Slow movement in shaders and film grain."} onChange={(animate) => update({ animate })} /><Slider label="Motion speed" value={cfg.speed} min={10} max={300} unit="%" disabled={!cfg.animate || reducedMotion || !isShaderStyle(cfg.style)} onChange={(speed) => update({ speed })} /><Slider label="Film grain" value={cfg.grain} min={0} max={40} unit="%" onChange={(grain) => update({ grain })} /><div className="glass-divider" /><div className="glass-field"><label className="glass-control-label" htmlFor="glass-quality">Rendering quality</label><select id="glass-quality" value={cfg.quality} onChange={(event) => update({ quality: event.target.value as GlassConfig["quality"] })}><option value="low">Light · 15 fps</option><option value="balanced">Balanced · 24 fps</option><option value="high">Detailed · 30 fps</option></select><p className="glass-hint">Light uses fewer pixels and frames. Shaders pause while VesnALIA is hidden and respect reduced motion.</p></div></>}
            {tab === "Shader" && <><div className="glass-section-heading"><h2>{shaderId ? "Edit shader" : "Add a shader"}</h2><button className="glass-button" type="button" onClick={() => void importer.current?.click()}>Import</button><input ref={importer} type="file" accept=".glsl,.frag,.json" aria-label="Import shader file" hidden onChange={(event) => void importShader(event.target.files?.[0])} /></div><div className="glass-field"><label className="glass-control-label" htmlFor="glass-shader-name">Name</label><input id="glass-shader-name" value={shaderName} maxLength={60} onChange={(event) => setShaderName(event.target.value)} /></div><div className="glass-field"><label className="glass-control-label" htmlFor="glass-shader-code">Fragment shader</label><textarea id="glass-shader-code" className="glass-code" value={source} spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={16384} aria-describedby="glass-shader-help" onChange={(event) => { setSource(event.target.value); setValidated(null); setShaderStatus(""); }} /></div><p id="glass-shader-help" className="glass-hint">GLSL ES 1.00 · Use <code>mainImage</code>. Import .glsl, .frag, or a Transparency .json export.</p>
              <details className="glass-shader-reference"><summary>Shader inputs &amp; example</summary><p><code>iResolution</code> · vec3, canvas size<br /><code>iTime</code> · float, seconds<br /><code>iMouse</code> · vec4, fixed at zero<br /><code>uColorA / B / C</code> · vec3, your palette</p><p>Inputs are already declared. No external textures, includes, or JavaScript.</p><button className="glass-button" type="button" onClick={() => { setSource(STARTER_SHADER); setValidated(null); setShaderStatus(""); }}>Load example</button></details>
              {shaderError && <pre className="glass-compiler-error" role="alert">{shaderError}</pre>}
              {libraryFull && <p className="glass-field-error" role="status">Your library holds {MAX_SHADERS} shaders. Remove one before adding another.</p>}
              <div className="glass-actions"><button type="button" className="glass-button" onClick={previewShader}>Preview shader</button><button type="button" className="glass-button glass-primary" disabled={saving || validated !== source.trim() || !shaderParsed.success || libraryFull} onClick={() => void doSaveShader()}>Save &amp; use</button></div>
              <div className="glass-actions"><button type="button" className="glass-text-button" disabled={!shaderParsed.success} onClick={exportShader}>Export code</button>{draft && <button type="button" className="glass-text-button" onClick={() => { setDraft(null); setValidated(null); setShaderError(null); }}>Exit preview</button>}</div><p className="glass-hint" role="status">{shaderStatus || (validated === source.trim() ? "Preview passed. Ready to save." : "Preview successfully before saving. Your current backdrop stays active.")}</p>
            </>}
          </div>
        </section>
      </div>
    </fieldset>
    <footer className="glass-footer"><p className="glass-hint">A backdrop inside VesnALIA. Changes sync across your open windows.</p>{confirmReset ? <div className="glass-confirm"><p>Reset appearance and turn transparency off? Your saved shaders stay in the library.</p><div className="glass-actions"><button className="glass-button glass-destructive" disabled={saving || !!error} onClick={() => void doReset()}>{resetting ? "Resetting…" : "Reset all settings"}</button><button className="glass-button" disabled={resetting} onClick={() => setConfirmReset(false)}>Cancel</button></div></div> : <button className="glass-text-button" disabled={saving || !!error} onClick={() => setConfirmReset(true)}>Reset settings…</button>}</footer>
  </div>;
}
