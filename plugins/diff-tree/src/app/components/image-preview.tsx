import { useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ChangedFile } from "../../core/tree";
import type { ImagePair, ImageSide } from "../../shared/images";
import type { rpcContract } from "../../shared/contracts";
import type { Snapshot } from "../hooks/use-changes";
import { usePreferences } from "../hooks/use-preferences";
import { DiffLoading } from "./diff-loading";

type ImageState<T> = { key: string; value?: T; error?: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ImageDiff({ snapshot, file }: { snapshot: Snapshot; file: ChangedFile }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<ImageState<ImagePair>>();
  const { smoothTransitions } = usePreferences();
  const key = JSON.stringify([snapshot.environmentId, snapshot.target, snapshot.mergeBaseRef, file.path, file.previousPath]);
  useEffect(() => {
    let active = true;
    const target = snapshot.target.type === "all" ? snapshot.mergeBaseRef ? { type: "all" as const, mergeBaseRef: snapshot.mergeBaseRef } : null : snapshot.target;
    if (!target) { setState({ key, error: "Refresh to resolve the comparison revision." }); return; }
    rpc.call("imageDiff", { environmentId: snapshot.environmentId, target, path: file.path, previousPath: file.previousPath })
      .then(value => { if (active) setState({ key, value }); }, error => { if (active) setState({ key, error: message(error) }); });
    return () => { active = false; };
  }, [rpc, snapshot, file.path, file.previousPath, key]);
  const current = state?.key === key ? state : undefined;
  return !current ? <DiffLoading smooth={smoothTransitions} /> : current.error ? <div className="dt-notice dt-error" role="alert">{current.error}</div> : <ImagePreview old={current.value!.old} next={current.value!.next} path={file.path} />;
}
export function WorktreeImage({ environmentId, path, revision }: { environmentId: string; path: string; revision: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<ImageState<ImageSide>>();
  const { smoothTransitions } = usePreferences();
  const key = JSON.stringify([environmentId, path]);
  useEffect(() => {
    let active = true;
    rpc.call("imageFile", { environmentId, path })
      .then(value => { if (active) setState({ key, value }); }, error => { if (active) setState({ key, error: message(error) }); });
    return () => { active = false; };
  }, [rpc, environmentId, path, revision, key]);
  const current = state?.key === key ? state : undefined;
  return !current ? <DiffLoading smooth={smoothTransitions} /> : current.error ? <div className="dt-notice dt-error" role="alert">{current.error}</div> : <ImagePreview next={current.value!} path={path} />;
}
function ImageCard({ image, label, path, fit }: { image: ImageSide; label: string; path: string; fit: boolean }) {
  // SVG is rendered only in the browser's static image context, never as markup.
  const src = useMemo(() => image.kind === "image" ? `data:${image.mimeType};base64,${image.content}` : undefined, [image]);
  const [loaded, setLoaded] = useState<{ src: string; width?: number; height?: number; failed?: boolean }>();
  const current = loaded?.src === src ? loaded : undefined;
  return <figure className="dt-image-card">
    <figcaption><strong>{label}</strong>{image.kind === "image" && <span>{current?.width !== undefined && `${current.width} × ${current.height} · `}{image.sizeBytes < 1024 ? `${image.sizeBytes} B` : `${(image.sizeBytes / 1024).toFixed(1)} KiB`}</span>}</figcaption>
    {image.kind === "missing" ? <div className="dt-notice">Not present in this revision.</div> : image.kind === "unavailable" ? <div className="dt-notice" role="status">{image.message}</div> : current?.failed ? <div className="dt-notice" role="status">This image could not be decoded by your browser.</div> : <div className={`dt-image-canvas${fit ? " dt-image-fit" : ""}`}>
      <img src={src} alt={`${label}: ${path}`} referrerPolicy="no-referrer" draggable={false}
        onLoad={event => setLoaded({ src: src!, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => setLoaded({ src: src!, failed: true })} />
    </div>}
  </figure>;
}
export function ImagePreview({ old, next, path }: { old?: ImageSide; next: ImageSide; path: string }) {
  const [fit, setFit] = useState(true);
  return <section className="dt-image-preview" aria-label={old ? "Image comparison" : "Image preview"}>
    <div className="dt-image-toolbar"><span>{old ? "Image comparison" : "Working-copy image"}</span><div className="dt-segment" role="group" aria-label="Image zoom"><button type="button" aria-pressed={fit} onClick={() => setFit(true)}>Fit</button><button type="button" aria-pressed={!fit} onClick={() => setFit(false)}>100%</button></div></div>
    <div className={`dt-image-grid${old ? " dt-image-pair" : ""}`}>
      {old && <ImageCard image={old} label="Before" path={path} fit={fit} />}
      <ImageCard image={next} label={old ? "After" : "Working copy"} path={path} fit={fit} />
    </div>
  </section>;
}
