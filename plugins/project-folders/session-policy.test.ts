import { describe, expect, it } from "vitest";
import {
  normalizeSessionPolicy,
  resolveSessionPolicy,
  toCorePolicy,
} from "./session-policy";

const folder = { scope: "folder" as const, folderId: "f1" };
const project = { scope: "project" as const, folderId: null };
const global = { scope: "global" as const, folderId: null };

describe("session context rules", () => {
  it("takes each group from the nearest place that sets it", () => {
    const resolved = resolveSessionPolicy([
      {
        origin: folder,
        value: { skills: { mode: "allow", names: ["ru-text"] } },
      },
      {
        origin: project,
        value: {
          skills: { mode: "deny", names: ["x"] },
          mcpServers: { mode: "deny", names: ["discord-web"] },
        },
      },
      { origin: global, value: { userInstructions: false } },
    ]);
    expect(resolved.skills).toEqual({
      value: { mode: "allow", names: ["ru-text"] },
      origin: folder,
    });
    expect(resolved.mcpServers?.origin).toEqual(project);
    expect(resolved.userInstructions).toEqual({ value: false, origin: global });
    expect(resolved.aliaPlugins).toBeNull();
  });

  it("lets a section lift a parent's restriction with `all`", () => {
    const resolved = resolveSessionPolicy([
      { origin: folder, value: { skills: { mode: "all", names: [] } } },
      { origin: project, value: { skills: { mode: "deny", names: ["x"] } } },
    ]);
    expect(toCorePolicy(resolved)).toBeNull();
  });

  it("sends core only real restrictions", () => {
    expect(
      toCorePolicy(
        resolveSessionPolicy([
          {
            origin: project,
            value: {
              aliaPlugins: { mode: "deny", names: ["image-studio"] },
              userInstructions: true,
            },
          },
        ]),
      ),
    ).toEqual({ aliaPlugins: { mode: "deny", names: ["image-studio"] } });
  });

  it("trims and deduplicates names, and empties `all`", () => {
    expect(
      normalizeSessionPolicy({
        skills: { mode: "allow", names: [" a ", "a", "b"] },
        mcpServers: { mode: "all", names: ["stale"] },
      }),
    ).toEqual({
      skills: { mode: "allow", names: ["a", "b"] },
      mcpServers: { mode: "all", names: [] },
    });
  });

  it("sends switched-off project instructions and claude.ai sync", () => {
    expect(
      toCorePolicy(
        resolveSessionPolicy([
          {
            origin: folder,
            value: { projectInstructions: false, claudeAiSync: true },
          },
          { origin: global, value: { claudeAiSync: false } },
        ]),
      ),
    ).toEqual({ projectInstructions: false });
  });

  it("never lets a rule take out what VesnALIA needs to run threads", () => {
    expect(
      toCorePolicy(
        resolveSessionPolicy([
          {
            origin: folder,
            value: {
              aliaPlugins: {
                mode: "deny",
                names: ["agency", "environment-project-checkout"],
              },
              mcpServers: { mode: "allow", names: ["gitnexus"] },
            },
          },
        ]),
      ),
    ).toEqual({
      aliaPlugins: { mode: "deny", names: ["agency"] },
      mcpServers: { mode: "allow", names: ["alia-bridge", "gitnexus"] },
    });
    expect(
      toCorePolicy(
        resolveSessionPolicy([
          {
            origin: project,
            value: { aliaPlugins: { mode: "allow", names: ["env-catalog"] } },
          },
        ]),
      ),
    ).toEqual({
      aliaPlugins: {
        mode: "allow",
        names: [
          "environment-project-checkout",
          "project-folders",
          "env-catalog",
        ],
      },
    });
    expect(
      normalizeSessionPolicy({
        mcpServers: { mode: "deny", names: ["alia-bridge", "discord-web"] },
      }),
    ).toEqual({ mcpServers: { mode: "deny", names: ["discord-web"] } });
  });
});
