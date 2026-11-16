import { isImagePath } from "../../shared/images";
import { WorktreeImage } from "./image-preview";
import type { CSSProperties } from "react";
import { experimental_FileLink as FileLink, experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { Environment } from "../../core/comparison-base";
import { useWorktreeFile } from "../hooks/use-worktree";
import { usePreferences } from "../hooks/use-preferences";
import { FileIcon } from "./file-icon";
import { ActionIcon } from "./action-icon";
import { DiffLoading } from "./diff-loading";
import { SourcePreview } from "./source-preview";

export function FileSource({ environment, path, revision, mention }: { environment: Environment; path: string; revision: number; mention: (path: string) => void }) {
  const image = isImagePath(path);
  const source = useWorktreeFile(environment, path, revision, !image);
  const { smoothTransitions, fontSize } = usePreferences();
  return <section className="dt-preview" aria-label="Selected file source">
    <header className="dt-file-header"><FileIcon path={path} /><div className="dt-file-path"><strong>{path}</strong><small>Working-copy file</small></div>
      <button type="button" className="dt-action" title="Add file mention to chat" aria-label="Add file mention to chat" onClick={() => mention(path)}><ActionIcon kind="quote" /></button>
      <FileLink target={{ kind: "workspace", environmentId: environment.id, path }} className="dt-open" title="Open file" aria-label="Open file"><Icon name="ExternalLink" className="dt-icon" /></FileLink>
    </header>
    <div className="dt-diff-body" aria-busy={!image && !source} style={{ "--diffs-font-size": `${fontSize}px`, "--diffs-line-height": `${Math.round(fontSize * 1.5)}px` } as CSSProperties}>
      {image ? <WorktreeImage environmentId={environment.id} path={path} revision={revision} /> : !source ? <DiffLoading smooth={smoothTransitions} /> : source.error ? <div className="dt-notice dt-error" role="alert">{source.error}</div> : source.notice ? <div className="dt-notice" role="status">{source.notice}</div> : source.content === "" ? <div className="dt-notice" role="status">Empty file.</div> : <div className={smoothTransitions ? "dt-diff-reveal-smooth" : undefined} key={path}><SourcePreview content={source.content!} path={path} /></div>}
    </div>
  </section>;
}
