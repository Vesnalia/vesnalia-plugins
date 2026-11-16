import { useMemo } from "react";
import { File, VirtualizerContext } from "@pierre/diffs/react";
import { experimental_useCodeTheme } from "@vesnalia/plugin-sdk/app";

/** A bounded, complete source document; scrolling never changes its row window. */
export function SourcePreview({ content, path }: { content: string; path: string }) {
  const theme = experimental_useCodeTheme();
  const lineNumbers = useMemo(() => {
    const count = content.split("\n").length - Number(content.endsWith("\n"));
    return count > 10_000 ? Array.from({ length: count }, (_, index) => String(index + 1)).join("\n") : undefined;
  }, [content]);
  const file = useMemo(() => ({ name: path, contents: content }), [path, content]);
  const options = useMemo(() => ({ disableFileHeader: true, overflow: "scroll" as const, theme: theme.theme?.name ?? theme.name, themeType: theme.mode }), [theme.theme?.name, theme.name, theme.mode]);
  return <div className="dt-source-code" role="region" aria-label={`Source code: ${path}`}>
    {/* Keep this preview independent from the host SourceCode virtualizer's
        partial-render path, which can throw when the visible window changes. */}
    {lineNumbers !== undefined ? <>
      <p className="dt-context">Plain text preview for files over 10,000 lines.</p>
      <div className="dt-source-plain"><pre aria-hidden="true" className="dt-source-numbers">{lineNumbers}</pre><pre><code>{content}</code></pre></div>
    </> : <VirtualizerContext.Provider value={undefined}>
      <File key={path} file={file} options={options} disableWorkerPool />
    </VirtualizerContext.Provider>}
  </div>;
}
