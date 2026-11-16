import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { describe, expect, it } from "vitest";
import { findProject, personalProjectId } from "./projects";

const ref = { owner: "Acme", repo: "web", number: 7 };
const aliaWith = (projects: object[]) => ({ sdk: { projects: { list: async () => projects } } }) as unknown as AliaPluginApi;

describe("the VesnALIA project for a PR", () => {
  it("is the one whose GitHub remote is the PR's repository, ignoring case and .git", async () => {
    const alia = aliaWith([
      { id: "other", name: "Other", gitRemoteUrl: "git@github.com:acme/api.git" },
      { id: "none", name: "No remote" },
      { id: "web", name: "Web", gitRemoteUrl: "git@github.com:ACME/web.git", sources: [{ type: "local_path", hostId: "laptop", path: "/src/web" }] },
    ]);
    expect(await findProject(alia, ref)).toEqual({ projectId: "web", projectName: "Web", hostId: "laptop", path: "/src/web", remoteUrl: "git@github.com:ACME/web.git" });
  });

  it("uses the default source, and has no path for a source that is not a local folder", async () => {
    const alia = aliaWith([
      {
        id: "web",
        name: "Web",
        gitRemoteUrl: "https://github.com/acme/web/",
        sources: [{ type: "local_path", hostId: "laptop", path: "/src/web" }, { type: "remote", hostId: "server", isDefault: true }],
      },
    ]);
    expect(await findProject(alia, ref)).toMatchObject({ hostId: "server", path: null });
  });

  it("has no host or path for a project with no sources, or a local source without a path", async () => {
    expect(await findProject(aliaWith([{ id: "web", name: "Web", gitRemoteUrl: "https://github.com/acme/web" }]), ref)).toMatchObject({ hostId: null, path: null });
    const pathless = aliaWith([{ id: "web", name: "Web", gitRemoteUrl: "https://github.com/acme/web", sources: [{ type: "local_path", hostId: "laptop" }] }]);
    expect(await findProject(pathless, ref)).toMatchObject({ hostId: "laptop", path: null });
  });

  it("is null when no project has the PR's repository, or the remote is not GitHub", async () => {
    expect(await findProject(aliaWith([{ id: "x", name: "X", gitRemoteUrl: "https://gitlab.com/acme/web" }]), ref)).toBeNull();
  });
});

describe("the personal project", () => {
  it("is found among all projects, and its absence is an error", async () => {
    expect(await personalProjectId(aliaWith([{ id: "team" }, { id: "me", kind: "personal" }]))).toBe("me");
    await expect(personalProjectId(aliaWith([{ id: "team" }]))).rejects.toThrow("No personal project");
  });
});
