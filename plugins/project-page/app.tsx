import { useEffect, useState } from "react";
import { definePluginApp, Markdown, UrlLink, useAliaNavigate, useRpc, type PluginNavPanelProps } from "@vesnalia/plugin-sdk/app";
import type { ProjectPageData, rpcContract } from "./server";
import { mountProjectTitleLinks } from "./title-link";
import "./app.css";

function ProjectTitleLinks() {
  const navigate = useAliaNavigate();
  useEffect(() => mountProjectTitleLinks(document, projectId => navigate.toPluginPanel("home", { subPath: projectId })), [navigate]);
  return null;
}

function ProjectPage({ subPath }: PluginNavPanelProps) {
  const projectId = subPath.replace(/^\/+|\/+$/g, "");
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useAliaNavigate();
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [data, setData] = useState<ProjectPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let current = true;
    setData(null); setError(null); setProjects(null);
    if (!projectId) {
      rpc.call("projects").then(result => { if (current) setProjects(result); }, cause => { if (current) setError(String(cause)); });
    } else {
      rpc.call("page", { projectId }).then(result => { if (current) setData(result); }, cause => { if (current) setError(String(cause)); });
    }
    return () => { current = false; };
  }, [rpc, projectId, revision]);
  return <div data-project-page-id={projectId || undefined} className="project-page h-full min-h-0 overflow-y-auto">
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8 md:py-8">
      {!projectId ? <div className="grid gap-2">
        {projects?.map(project => <button key={project.id} className="project-page-choice" onClick={() => navigate.toPluginPanel("home", { subPath: project.id })}>{project.name}<span aria-hidden="true">↗</span></button>)}
        {!error && <p role="status" className="text-muted-foreground">{projects === null ? "Loading projects…" : projects.length === 0 ? "No projects to show." : ""}</p>}
      </div> : <>
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-semibold tracking-tight">{data?.project.name ?? "Project"}</h1>
            {data?.repositoryUrl && <UrlLink className="mt-2 inline-block break-all text-sm text-muted-foreground underline underline-offset-4" href={data.repositoryUrl}>{data.repositoryUrl.replace(/^https?:\/\//, "")}</UrlLink>}
          </div>
          <div className="flex gap-2">
            <button className="project-page-button" onClick={() => refresh(value => value + 1)} aria-label="Refresh project page">Refresh</button>
            <button className="project-page-button" onClick={() => navigate.toProject(projectId)}>New thread</button>
          </div>
        </header>
        {!data && !error && <p role="status" className="text-sm text-muted-foreground">Loading README…</p>}
        {data?.error && <p role="alert" className="mb-4 text-sm text-destructive">{data.error}</p>}
        {data?.readme ? <section aria-label="Project README" className="min-w-0 border-t border-border pt-6">
          <p className="mb-5 text-xs text-muted-foreground">{data.readme.path}</p>
          <Markdown content={data.readme.content} />
        </section> : data && !data.error && <div className="rounded-lg border border-dashed border-border px-5 py-8 text-sm text-muted-foreground">No README found in this project.</div>}
      </>}
      {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p><button className="project-page-button mt-3" onClick={() => refresh(value => value + 1)}>Try again</button></div>}
    </div>
  </div>;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: "project-title-links", component: ProjectTitleLinks });
  app.slots.navPanel({ id: "home", path: "home", title: "Project home", icon: "Folder", component: ProjectPage });
});
