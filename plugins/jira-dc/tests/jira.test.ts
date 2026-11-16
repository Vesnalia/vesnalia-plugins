import { describe, expect, it } from "vitest";
import {
  JiraClient,
  PERMISSION_ALWAYS,
  PERMISSION_ASK,
  buildViewJql,
  describeJiraError,
  encodeCreateFieldValue,
  isIssueKey,
  normalizeCreateFields,
  normalizeIssue,
  normalizeSiteUrl,
  requiresApproval,
  scopeJql,
} from "../jira";

describe("normalizeSiteUrl", () => {
  it("accepts a host or a full URL and keeps the origin", () => {
    expect(normalizeSiteUrl("jira.company.com")).toBe("https://jira.company.com");
    expect(normalizeSiteUrl("https://jira.company.com/secure/Dashboard.jspa")).toBe(
      "https://jira.company.com",
    );
    expect(normalizeSiteUrl("http://jira.internal/")).toBe("http://jira.internal");
  });

  it("refuses empty input", () => {
    expect(normalizeSiteUrl("   ")).toBeNull();
  });
});

describe("issue keys", () => {
  it("matches PROJ-123 and nothing looser", () => {
    expect(isIssueKey("PROJ-123")).toBe(true);
    expect(isIssueKey("AB2_X-1")).toBe(true);
    expect(isIssueKey("proj-123")).toBe(false);
    expect(isIssueKey("PROJ-0")).toBe(false);
    expect(isIssueKey("PROJ-1/../x")).toBe(false);
  });
});

describe("buildViewJql", () => {
  it("combines view, project, open-only, and quoted text", () => {
    expect(
      buildViewJql({ view: "assigned", projectKey: "WEB", text: 'say "hi"', includeDone: false }),
    ).toBe(
      'project = "WEB" AND assignee = currentUser() AND statusCategory != Done AND text ~ "say \\"hi\\"" ORDER BY updated DESC',
    );
  });

  it("searches by key when the text looks like one", () => {
    expect(buildViewJql({ view: "all", projectKey: "", text: "web-12", includeDone: true })).toBe(
      '(key = "WEB-12" OR text ~ "web-12") ORDER BY updated DESC',
    );
  });

  it("keeps an otherwise unrestricted query bounded", () => {
    expect(buildViewJql({ view: "all", projectKey: "", text: "", includeDone: true })).toBe(
      "created >= -365d ORDER BY updated DESC",
    );
  });
});

describe("requiresApproval", () => {
  it("only skips approval for an explicit Always allow", () => {
    expect(requiresApproval(PERMISSION_ALWAYS)).toBe(false);
    expect(requiresApproval(PERMISSION_ASK)).toBe(true);
    expect(requiresApproval(undefined)).toBe(true);
    expect(requiresApproval("always")).toBe(true);
  });
});

describe("normalizeIssue", () => {
  it("fills every field from a sparse payload", () => {
    const issue = normalizeIssue(
      {
        key: "WEB-7",
        fields: {
          summary: "Fix login",
          status: { name: "In Review", statusCategory: { key: "indeterminate" } },
          assignee: null,
          description: "h1. Broken",
        },
      },
      "https://jira.company.com",
    );
    expect(issue).toMatchObject({
      key: "WEB-7",
      projectKey: "WEB",
      summary: "Fix login",
      status: "In Review",
      statusCategory: "inprogress",
      assignee: null,
      labels: [],
      description: "# Broken",
      url: "https://jira.company.com/browse/WEB-7",
    });
  });
});

describe("describeJiraError", () => {
  it("surfaces Jira's field errors", () => {
    expect(
      describeJiraError(400, JSON.stringify({ errorMessages: [], errors: { summary: "required" } })),
    ).toBe("Jira responded 400: summary: required");
  });
});

describe("normalizeCreateFields", () => {
  it("keeps required custom fields and marks built-ins", () => {
    const fields = normalizeCreateFields({
      summary: { required: true, name: "Summary", schema: { type: "string", system: "summary" } },
      project: { required: true, name: "Project", schema: { type: "project", system: "project" } },
      components: {
        required: true,
        name: "Component/s",
        schema: { type: "array", items: "component", system: "components" },
        allowedValues: [{ id: "1", name: "API" }],
      },
      customfield_10040: {
        required: true,
        name: "Team",
        schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" },
        allowedValues: [{ id: "10", value: "Platform" }],
      },
      labels: {
        required: false,
        name: "Labels",
        schema: { type: "array", items: "string", system: "labels" },
      },
    });
    expect(fields.map((field) => field.key)).toEqual([
      "components",
      "summary",
      "customfield_10040",
      "labels",
    ]);
    expect(fields.find((field) => field.key === "summary")?.builtIn).toBe("summary");
    expect(fields.find((field) => field.key === "components")).toMatchObject({
      kind: "multiselect",
      required: true,
      allowedValues: [{ id: "1", label: "API" }],
    });
    expect(fields.find((field) => field.key === "customfield_10040")).toMatchObject({
      kind: "select",
      allowedValues: [{ id: "10", label: "Platform" }],
    });
  });

  it("accepts the modern createmeta array shape", () => {
    const fields = normalizeCreateFields([
      {
        fieldId: "priority",
        name: "Priority",
        required: true,
        schema: { type: "priority", system: "priority" },
        allowedValues: [{ id: "3", name: "Medium" }],
      },
    ]);
    expect(fields).toEqual([
      expect.objectContaining({ key: "priority", builtIn: "priority", kind: "select", required: true }),
    ]);
  });
});

describe("encodeCreateFieldValue", () => {
  it("encodes select, multiselect, and labels for Jira", () => {
    expect(
      encodeCreateFieldValue(
        {
          key: "customfield_1",
          name: "Team",
          required: true,
          kind: "select",
          allowedValues: [{ id: "10", label: "Platform" }],
          hasDefaultValue: false,
        },
        "10",
      ),
    ).toEqual({ id: "10" });
    expect(
      encodeCreateFieldValue(
        {
          key: "components",
          name: "Component/s",
          required: true,
          kind: "multiselect",
          allowedValues: [],
          hasDefaultValue: false,
        },
        ["1", "2"],
      ),
    ).toEqual([{ id: "1" }, { id: "2" }]);
    expect(
      encodeCreateFieldValue(
        {
          key: "labels",
          name: "Labels",
          required: false,
          kind: "labels",
          allowedValues: [],
          hasDefaultValue: false,
        },
        "a, b",
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("JiraClient listCreateFields", () => {
  it("falls back to classic createmeta when the modern path is missing", async () => {
    const urls: string[] = [];
    const client = new JiraClient(
      { siteUrl: "https://jira.company.com", pat: "pat" },
      async (url) => {
        urls.push(String(url));
        if (String(url).includes("/issuetypes/")) {
          return new Response("gone", { status: 404 });
        }
        return new Response(
          JSON.stringify({
            projects: [
              {
                issuetypes: [
                  {
                    fields: {
                      customfield_9: {
                        required: true,
                        name: "Severity",
                        schema: { type: "option" },
                        allowedValues: [{ id: "1", value: "Sev1" }],
                      },
                    },
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    const fields = await client.listCreateFields("WEB", "10001");
    expect(urls[0]).toContain("/createmeta/WEB/issuetypes/10001");
    expect(urls[1]).toContain("expand=projects.issuetypes.fields");
    expect(fields).toEqual([
      expect.objectContaining({ key: "customfield_9", name: "Severity", kind: "select", required: true }),
    ]);
  });
});

describe("JiraClient", () => {
  it("sends Bearer PAT and wiki markup, and maps 401 to a configuration error", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new JiraClient(
      { siteUrl: "https://jira.company.com", pat: "pat-tok" },
      async (url, init) => {
        calls.push({ url, init });
        return calls.length === 1
          ? new Response(JSON.stringify({ id: "1", body: "*hi*" }), { status: 201 })
          : new Response("", { status: 401 });
      },
    );
    await client.addComment("WEB-1", "**hi**");
    const [first] = calls;
    expect(first?.url).toBe("https://jira.company.com/rest/api/2/issue/WEB-1/comment");
    expect((first?.init.headers as Record<string, string>).authorization).toBe("Bearer pat-tok");
    expect(JSON.parse(String(first?.init.body))).toEqual({ body: "*hi*" });
    await expect(client.myself()).rejects.toMatchObject({ name: "NeedsConfigurationError" });
  });
});

describe("buildViewJql assignee filter", () => {
  it("narrows to people and unassigned together", () => {
    expect(
      buildViewJql({
        view: "all",
        projectKey: "",
        text: "",
        includeDone: true,
        assignees: ["u-1", "u-2", "u-1"],
        unassigned: true,
      }),
    ).toBe('(assignee in ("u-1", "u-2") OR assignee is EMPTY) ORDER BY updated DESC');
  });

  it("uses a single clause without parentheses", () => {
    expect(
      buildViewJql({ view: "recent", projectKey: "", text: "", includeDone: true, unassigned: true }),
    ).toBe("assignee is EMPTY AND updated >= -14d ORDER BY updated DESC");
  });

  it("ignores it on the assigned-to-me view", () => {
    expect(
      buildViewJql({ view: "assigned", projectKey: "", text: "", includeDone: true, assignees: ["u-1"] }),
    ).toBe("assignee = currentUser() ORDER BY updated DESC");
  });
});

describe("scopeJql", () => {
  it("wraps the filter and keeps ORDER BY last", () => {
    expect(scopeJql("status = Done OR assignee = currentUser() ORDER BY rank", ["WEB"])).toBe(
      'project = "WEB" AND (status = Done OR assignee = currentUser()) ORDER BY rank',
    );
  });

  it("handles order-only JQL, several projects, and no projects", () => {
    expect(scopeJql("order by updated DESC", ["WEB", "APP", "WEB"])).toBe(
      'project in ("WEB", "APP") order by updated DESC',
    );
    expect(scopeJql("  status = Done ", [])).toBe("status = Done");
  });

  it("ignores ORDER BY inside quoted text", () => {
    expect(scopeJql('text ~ "sort order by date" ORDER BY created', ["WEB"])).toBe(
      'project = "WEB" AND (text ~ "sort order by date") ORDER BY created',
    );
  });

  it("cannot be escaped by an OR in the caller's JQL", () => {
    // The parentheses are the point: without them `project = WEB AND a OR b`
    // would return b from every project.
    expect(scopeJql("project = OTHER OR key = X-1", ["WEB"])).toBe(
      'project = "WEB" AND (project = OTHER OR key = X-1)',
    );
  });
});
