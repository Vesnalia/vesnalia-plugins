/** Only expose navigable repository URLs, never credentials from a git remote. */
export function repositoryUrl(remote: string | null): string | null {
  if (!remote) return null;
  const scp = remote.match(/^git@([^:/]+):(.+)$/);
  try {
    const url = new URL(scp ? `https://${scp[1]}/${scp[2]}` : remote);
    if (!["https:", "http:", "ssh:"].includes(url.protocol)) return null;
    if (url.protocol === "ssh:") {
      return repositoryUrl(`https://${url.hostname}${url.pathname}`);
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\.git\/?$/, "");
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

export function selectReadme(paths: string[]): string | null {
  const choices = paths.filter(path => /^(?:(?:\.github|docs)\/)?readme(?:\.(?:md|markdown|txt))?$/i.test(path));
  const rank = (path: string) => (path.includes("/") ? 10 : 0) + (/\.md$/i.test(path) ? 0 : /\.markdown$/i.test(path) ? 1 : 2);
  return choices.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0] ?? null;
}
