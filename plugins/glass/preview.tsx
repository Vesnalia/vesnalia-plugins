import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GlassIcon } from "./icon";
import type { GlassConfig } from "./config";
import { resolvePalette, rgbOf } from "./colors";
import { createShaderRenderer, type ShaderRenderer } from "./shader-renderer";
import { isShaderStyle } from "./shaders";

export function cssBackdrop(config: GlassConfig, accent = rgbOf("--primary", [139, 145, 232])) {
  const [a, b] = resolvePalette(config, accent).map((color) => color.join(","));
  if (config.style === "image" && config.imageUrl) return `url(${JSON.stringify(config.imageUrl)}) center / cover no-repeat, #10121b`;
  if (config.style === "none") return "#10121b";
  return `radial-gradient(ellipse at 20% 110%, rgba(${a},.85), transparent 72%), radial-gradient(ellipse at 95% 5%, rgba(${b},.6), transparent 70%), #10121b`;
}

export function Artwork({ config, thumbnail = false, onResult }: { config: GlassConfig; thumbnail?: boolean; onResult?: (error: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<ShaderRenderer | null>(null);
  const callback = useRef(onResult); callback.current = onResult;
  const [failed, setFailed] = useState(false);
  const [snapshot, setSnapshot] = useState("");
  useEffect(() => {
    if (!host.current || !isShaderStyle(config.style)) { rig.current?.dispose(); rig.current = null; callback.current?.(null); return; }
    if (thumbnail) {
      const renderer = createShaderRenderer(host.current, { still: true });
      if (renderer?.update(config)) setSnapshot(renderer.canvas.toDataURL("image/png"));
      renderer?.dispose();
      return;
    }
    if (!rig.current) rig.current = createShaderRenderer(host.current, {
      onError: (message) => { setFailed(true); callback.current?.(message); },
      onReady: () => { setFailed(false); callback.current?.(null); },
    });
    rig.current?.update(config);
  }, [config, thumbnail]);
  useEffect(() => () => { rig.current?.dispose(); rig.current = null; }, []);
  return <div className="glass-artwork" style={{ background: cssBackdrop(config) }} aria-hidden="true">
    <div className="glass-canvas" ref={host} style={{ opacity: failed ? 0 : 1, filter: thumbnail ? undefined : `blur(${Math.round(config.blur / 3)}px)` }} />
    {thumbnail && snapshot && <img src={snapshot} alt="" className="glass-snapshot" />}
    {!thumbnail && <div className="glass-art-dim" style={{ opacity: config.dim / 100 }} />}
  </div>;
}

export function WorkspacePreview({ config, onResult, draft }: { config: GlassConfig; onResult: (error: string | null) => void; draft: boolean }) {
  const [workspace, setWorkspace] = useState(true);
  return <section className="glass-preview-section" aria-label="Appearance preview">
    <div className="glass-section-heading"><h2>{draft ? "Shader preview" : "Preview"}</h2>
      <div className="glass-segment" role="group" aria-label="Preview mode">
        <button type="button" aria-pressed={workspace} onClick={() => setWorkspace(true)}>Workspace</button>
        <button type="button" aria-pressed={!workspace} onClick={() => setWorkspace(false)}>Backdrop</button>
      </div>
    </div>
    <div className="glass-preview" style={{ "--glass-sample-opacity": config.opacity / 100, "--glass-sample-sidebar": config.sidebarOpacity / 100 } as CSSProperties}>
      <Artwork config={config} onResult={onResult} />
      {workspace && <div className="glass-sample" aria-hidden="true">
        <div className="glass-sample-sidebar"><span className="glass-sample-brand">VesnALIA</span><span>New thread</span><span className="glass-sample-active">Workspace</span><span>Extensions</span><i /><span className="glass-sample-subtle">Today</span><span>Review navigation</span><span>Refine the details</span></div>
        <div className="glass-sample-main"><div className="glass-sample-title">Review navigation <GlassIcon name="more" /></div><div className="glass-sample-body"><span className="glass-sample-subtle">You</span><p>Keep the workspace calm and easy to read.</p><span className="glass-sample-subtle">Assistant</span><p>The details are ready for your review.</p><div className="glass-sample-lines"><i /><i /><i /></div><div className="glass-sample-composer">Send a follow-up… <GlassIcon name="up" /></div></div></div>
      </div>}
      <span className="glass-preview-label">{workspace ? "Sample workspace" : "Backdrop only"}{draft ? " · Unsaved" : ""}</span>
    </div>
    <p className="glass-hint glass-preview-hint">{draft ? "This draft stays in the preview until you save it." : "Adjust the look here. Enable transparency to apply it across VesnALIA."}</p>
  </section>;
}
