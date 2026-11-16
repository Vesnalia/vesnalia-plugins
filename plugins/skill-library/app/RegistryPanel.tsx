import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRpc } from "@vesnalia/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LoadingBox } from "./SkillEditor";
import type { rpcContract } from "../server";
import type { RegistryPagination, RegistrySkill } from "./types";

export function RegistryPanel({ onInstalled }: { onInstalled: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<RegistrySkill[] | null>(null);
  const [pagination, setPagination] = useState<RegistryPagination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);

  const search = useCallback(
    (targetPage: number, targetQuery: string) => {
      setPending(true);
      setError(null);
      setInstalled(null);
      rpc
        .call("searchRegistry", { query: targetQuery, page: targetPage })
        .then(
          (result) => {
            setResults(result.skills);
            setPagination(result.pagination);
            setPage(targetPage);
            setPending(false);
          },
          (cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
            setPending(false);
          },
        );
    },
    [rpc],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    search(0, query.trim());
  };

  // Show trending skills immediately; a query narrows from there.
  const didAutoSearch = useRef(false);
  useEffect(() => {
    if (didAutoSearch.current) return;
    didAutoSearch.current = true;
    search(0, "");
  }, [search]);

  const install = (skill: RegistrySkill) => {
    setInstalling(skill.id);
    rpc
      .call("installRegistrySkill", { registrySkillId: skill.id })
      .then(
        () => {
          setInstalled(skill.id);
          setInstalling(null);
          onInstalled();
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          setInstalling(null);
        },
      );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search skills.sh…"
          aria-label="Search the skill registry"
          className="h-8 w-full rounded-md border border-border bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
        <Button type="submit" size="sm" disabled={pending}>
          <Icon name="Search" className="size-4" />
          Search
        </Button>
      </form>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results === null ? (
          <LoadingBox>Loading trending skills…</LoadingBox>
        ) : results.length === 0 ? (
          <LoadingBox>No registry results.</LoadingBox>
        ) : (
          <ul className="flex flex-col gap-2">
            {results.map((skill) => (
              <li
                key={skill.id}
                className="rounded-lg border border-border bg-card px-3 py-2.5"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{skill.name}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {skill.summary ?? skill.url}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {skill.installs} installs
                      {skill.topic ? ` · ${skill.topic}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={installing === skill.id}
                    onClick={() => install(skill)}
                  >
                    {installing === skill.id
                      ? "Installing…"
                      : installed === skill.id
                        ? "Installed"
                        : "Install"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {pagination !== null ? (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>
            Page {pagination.page + 1} · {pagination.total} results
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || pagination.page === 0}
            onClick={() => search(page - 1, query.trim())}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || !pagination.hasMore}
            onClick={() => search(page + 1, query.trim())}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
