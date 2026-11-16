import { describe, expect, it } from "vitest";
import { repoCheckout, ticketRepo } from "../src/checkouts";
import type { ProjectRow } from "../src/db/store";
import { LoomError } from "../src/projects";
import { parseSpec, type Spec } from "../src/spec";
import { FakePort, specToml, type Doc } from "./helpers";

function spec(edit?: (doc: Doc) => void): Spec {
  const result = parseSpec(specToml(edit));
  expect(result.errors).toEqual([]);
  return result.spec!;
}

const multi = () =>
  spec((doc) => {
    doc.repo = [
      { name: "web", project: "proj_web" },
      { name: "api", project: "proj_api", base: "trunk", remote: "upstream" },
    ];
    doc.ticket[0].repo = "web";
    doc.ticket[1].repo = "api";
  });

const project = (over: Partial<ProjectRow> = {}) => ({ alia_project_id: "proj_1", host_id: "host_1", ...over }) as ProjectRow;

async function failure(promise: Promise<unknown>): Promise<LoomError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(LoomError);
  return error as LoomError;
}

describe("ticketRepo", () => {
  it("is the settings of the ticket's repo, and of the project's own repository for null", () => {
    expect(ticketRepo(multi(), { repo: "api" })).toMatchObject({ name: "api", aliaProjectId: "proj_api", base: "trunk", remote: "upstream" });
    expect(ticketRepo(spec(), { repo: null })).toMatchObject({ name: null, aliaProjectId: null, base: "main", remote: "origin" });
  });
});

describe("repoCheckout", () => {
  it("returns the repo's checkout on the project's machine", async () => {
    const alia = new FakePort();
    alia.addAliaProject("proj_web", { host_1: "/src/web", host_2: "/other/web" });
    alia.addAliaProject("proj_api", { host_1: "/src/api" });
    const checkout = await repoCheckout({ alia }, project(), multi(), "web");
    expect(checkout).toMatchObject({ hostId: "host_1", aliaProjectId: "proj_web", path: "/src/web", settings: { name: "web", aliaProjectId: "proj_web", base: "main" } });
    expect(await repoCheckout({ alia }, project({ host_id: "host_2" }), multi(), "web")).toMatchObject({ hostId: "host_2", path: "/other/web" });
    expect(alia.callsTo("projectCheckout")).toEqual([
      ["proj_web", "host_1"],
      ["proj_web", "host_2"],
    ]);
  });

  it("returns the Loom project's own checkout for a null name", async () => {
    const alia = new FakePort();
    alia.checkouts.set("proj_1", { host_1: "/src/shop" });
    expect(await repoCheckout({ alia }, project(), spec(), null)).toEqual({ hostId: "host_1", aliaProjectId: "proj_1", path: "/src/shop", settings: expect.objectContaining({ name: null, base: "main" }) });
    expect(alia.callsTo("projectCheckout")).toEqual([["proj_1", "host_1"]]);
  });

  it("throws loom_no_checkout naming the repo and its VesnALIA project with the command that clones it there", async () => {
    const alia = new FakePort();
    alia.addAliaProject("proj_api", { host_2: "/src/api" });
    const error = await failure(repoCheckout({ alia }, project(), multi(), "api"));
    expect(error.code).toBe("loom_no_checkout");
    expect(error.message).toBe('Repo "api" (VesnALIA project proj_api) has no checkout on the machine host_1 that this Loom project uses. Clone it there with `alia project source add proj_api --clone --machine host_1`, then resume.');

    alia.checkout = null;
    expect((await failure(repoCheckout({ alia }, project(), spec(), null))).message).toContain("The project's repository (VesnALIA project proj_1) has no checkout on the machine host_1");
  });

  it("throws loom_no_checkout without asking VesnALIA when the project has no machine", async () => {
    const alia = new FakePort();
    const error = await failure(repoCheckout({ alia }, project({ host_id: null }), multi(), "web"));
    expect(error.message).toContain('Repo "web" (VesnALIA project proj_web) has no checkout on the machine (unknown)');
    expect(alia.callsTo("projectCheckout")).toEqual([]);
  });

  it("refuses a name the spec does not list", async () => {
    await expect(repoCheckout({ alia: new FakePort() }, project(), multi(), "docs")).rejects.toThrow('This spec has no repo "docs"');
  });
});
