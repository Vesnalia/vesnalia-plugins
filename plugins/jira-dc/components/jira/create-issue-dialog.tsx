import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { JiraCreateField, JiraProject, JiraUser } from "../../server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateFields, useCreateOptions, useJiraRpc } from "./hooks";
import { Avatar, PriorityMark, TypeGlyph, errorText } from "./primitives";

const DEFAULT_PRIORITY = "__default__";

function needsValue(field: JiraCreateField, raw: string | string[] | undefined): boolean {
  if (!field.required || field.hasDefaultValue) return false;
  if (raw === undefined) return true;
  if (Array.isArray(raw)) return raw.filter((value) => value.trim().length > 0).length === 0;
  return raw.trim().length === 0;
}

export function CreateIssueDialog({
  open,
  onOpenChange,
  projects,
  initialProjectKey,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: JiraProject[];
  initialProjectKey: string;
  onCreated: (key: string) => void;
}) {
  const rpc = useJiraRpc();
  const [projectKey, setProjectKey] = useState(initialProjectKey);
  const [issueType, setIssueType] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(DEFAULT_PRIORITY);
  const [assignee, setAssignee] = useState<JiraUser | null>(null);
  const [extraValues, setExtraValues] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const options = useCreateOptions(open ? projectKey : "");
  const createFields = useCreateFields(open ? projectKey : "", open ? issueType : "");

  useEffect(() => {
    if (open) setProjectKey((current) => current || initialProjectKey || projects[0]?.key || "");
  }, [open, initialProjectKey, projects]);

  // Default to Task (or the first non-sub-task type) whenever the project's
  // types change, since type ids differ between projects.
  useEffect(() => {
    const types = options.issueTypes.filter((type) => !type.subtask);
    if (types.some((type) => type.id === issueType)) return;
    setIssueType((types.find((type) => type.name.toLowerCase() === "task") ?? types[0])?.id ?? "");
  }, [options.issueTypes, issueType]);

  // Clear dynamic values when the type/project changes — ids and allowed lists differ.
  useEffect(() => {
    setExtraValues({});
    setAssignee(null);
    setPriority(DEFAULT_PRIORITY);
  }, [projectKey, issueType]);

  const requiredMeta = useMemo(
    () => createFields.fields.filter((field) => field.required),
    [createFields.fields],
  );
  const priorityMeta = requiredMeta.find((field) => field.builtIn === "priority");
  const descriptionRequired = requiredMeta.some(
    (field) => field.builtIn === "description" && needsValue(field, description),
  );
  const priorityRequired = priorityMeta !== undefined && !priorityMeta.hasDefaultValue;
  const assigneeRequired = requiredMeta.some(
    (field) => field.builtIn === "assignee" && needsValue(field, assignee?.accountId ?? ""),
  );
  const extraRequired = requiredMeta.filter((field) => field.builtIn === undefined);
  const priorityOptions =
    priorityMeta !== undefined && priorityMeta.allowedValues.length > 0
      ? priorityMeta.allowedValues.map((option) => option.label)
      : options.priorities;

  const reset = () => {
    setSummary("");
    setDescription("");
    setPriority(DEFAULT_PRIORITY);
    setAssignee(null);
    setExtraValues({});
  };

  const extrasFilled = extraRequired.every((field) => !needsValue(field, extraValues[field.key]));
  const canSubmit =
    projectKey.length > 0 &&
    issueType.length > 0 &&
    summary.trim().length > 0 &&
    !descriptionRequired &&
    (!priorityRequired || (priority !== DEFAULT_PRIORITY && priority.length > 0)) &&
    !assigneeRequired &&
    extrasFilled &&
    !busy &&
    !createFields.loading;

  const submit = () => {
    if (!canSubmit) return;
    setBusy(true);
    const encoded: Record<string, string | string[]> = {};
    for (const field of extraRequired) {
      const raw = extraValues[field.key];
      if (raw === undefined || needsValue(field, raw)) continue;
      encoded[field.key] = raw;
    }
    rpc
      .call("createIssue", {
        projectKey,
        issueType,
        summary: summary.trim(),
        description,
        priority: priority === DEFAULT_PRIORITY ? "" : priority,
        assigneeAccountId: assignee?.accountId ?? "",
        fields: encoded,
      })
      .then(({ key }) => {
        toast.success(`Created ${key}`);
        reset();
        onOpenChange(false);
        onCreated(key);
      })
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create issue</DialogTitle>
          <DialogDescription>Creates the issue in Jira right away.</DialogDescription>
        </DialogHeader>
        <form
          className="grid max-h-[min(70vh,36rem)] gap-3 overflow-y-auto pr-1"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project" required>
              <Select value={projectKey || undefined} onValueChange={setProjectKey}>
                <SelectTrigger aria-label="Project">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.key} value={project.key}>
                      {project.name} <span className="text-muted-foreground">({project.key})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Type" required>
              <Select
                value={issueType || undefined}
                onValueChange={setIssueType}
                disabled={options.issueTypes.length === 0}
              >
                <SelectTrigger aria-label="Issue type">
                  <SelectValue placeholder={options.loading ? "Loading…" : "Choose a type"} />
                </SelectTrigger>
                <SelectContent>
                  {options.issueTypes
                    .filter((type) => !type.subtask)
                    .map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        <span className="flex items-center gap-2">
                          <TypeGlyph type={type.name} />
                          {type.name}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Summary" required>
            <Input
              autoFocus
              aria-label="Summary"
              maxLength={255}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
          <Field
            label="Description"
            required={requiredMeta.some((field) => field.builtIn === "description" && !field.hasDefaultValue)}
          >
            <Textarea
              aria-label="Description"
              rows={5}
              placeholder="Markdown supported"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </Field>
          {priorityOptions.length > 0 || priorityRequired ? (
            <Field label="Priority" required={priorityRequired}>
              <Select
                value={priority === DEFAULT_PRIORITY && priorityRequired ? undefined : priority}
                onValueChange={setPriority}
              >
                <SelectTrigger aria-label="Priority" className="w-48">
                  <SelectValue placeholder={priorityRequired ? "Choose a priority" : undefined} />
                </SelectTrigger>
                <SelectContent>
                  {!priorityRequired ? (
                    <SelectItem value={DEFAULT_PRIORITY}>Project default</SelectItem>
                  ) : null}
                  {priorityOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      <span className="flex items-center gap-2">
                        <PriorityMark priority={name} />
                        {name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {requiredMeta.some((field) => field.builtIn === "assignee") ? (
            <Field label="Assignee" required={assigneeRequired}>
              <UserPicker projectKey={projectKey} value={assignee} onChange={setAssignee} />
            </Field>
          ) : null}
          {createFields.loading && issueType.length > 0 ? (
            <p className="text-xs text-muted-foreground">Loading required fields…</p>
          ) : null}
          {extraRequired.map((field) => (
            <DynamicField
              key={field.key}
              field={field}
              projectKey={projectKey}
              value={extraValues[field.key]}
              onChange={(next) => setExtraValues((previous) => ({ ...previous, [field.key]: next }))}
            />
          ))}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
    </div>
  );
}

function DynamicField({
  field,
  projectKey,
  value,
  onChange,
}: {
  field: JiraCreateField;
  projectKey: string;
  value: string | string[] | undefined;
  onChange: (next: string | string[]) => void;
}) {
  const label = field.name;
  const required = field.required && !field.hasDefaultValue;
  switch (field.kind) {
    case "textarea":
      return (
        <Field label={label} required={required}>
          <Textarea
            aria-label={label}
            rows={3}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
    case "number":
      return (
        <Field label={label} required={required}>
          <Input
            aria-label={label}
            type="number"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
    case "date":
    case "datetime":
      return (
        <Field label={label} required={required}>
          <Input
            aria-label={label}
            type={field.kind === "date" ? "date" : "datetime-local"}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
    case "select":
      return (
        <Field label={label} required={required}>
          <Select
            value={typeof value === "string" && value.length > 0 ? value : undefined}
            onValueChange={onChange}
          >
            <SelectTrigger aria-label={label}>
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {field.allowedValues.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );
    case "multiselect":
      return (
        <Field label={label} required={required}>
          <MultiOptionList
            label={label}
            options={field.allowedValues}
            value={Array.isArray(value) ? value : []}
            onChange={onChange}
          />
        </Field>
      );
    case "labels":
      return (
        <Field label={label} required={required}>
          <Input
            aria-label={label}
            placeholder="Comma-separated labels"
            value={typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
    case "user":
      return (
        <Field label={label} required={required}>
          <UserPicker
            projectKey={projectKey}
            value={
              typeof value === "string" && value.length > 0
                ? { accountId: value, displayName: value, email: "" }
                : null
            }
            onChange={(user) => onChange(user?.accountId ?? "")}
          />
        </Field>
      );
    case "text":
    case "unsupported":
    default:
      return (
        <Field label={label} required={required}>
          <Input
            aria-label={label}
            placeholder={field.kind === "unsupported" ? "Value as in Jira (or JSON)" : undefined}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
  }
}

function MultiOptionList({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const selected = new Set(value);
  if (options.length === 0) {
    return (
      <Input
        aria-label={label}
        placeholder="Comma-separated ids"
        value={value.join(", ")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part.length > 0),
          )
        }
      />
    );
  }
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2" aria-label={label}>
      {options.map((option) => {
        const checked = selected.has(option.id);
        return (
          <li key={option.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={checked}
              onCheckedChange={(next) => {
                const on = next === true;
                onChange(on ? [...value, option.id] : value.filter((id) => id !== option.id));
              }}
              aria-label={option.label}
            />
            <span className="truncate">{option.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function UserPicker({
  projectKey,
  value,
  onChange,
}: {
  projectKey: string;
  value: JiraUser | null;
  onChange: (user: JiraUser | null) => void;
}) {
  const rpc = useJiraRpc();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<JiraUser[] | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      rpc.call("findUsers", { issueKey: "", projectKey, query: query.trim() }).then(
        (found) => live && setUsers(found),
        () => live && setUsers([]),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, projectKey, query]);

  return (
    <div className="space-y-1">
      {value !== null ? (
        <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
          <Avatar user={value} />
          <span className="min-w-0 flex-1 truncate">{value.displayName}</span>
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onChange(null)}>
            Clear
          </Button>
        </div>
      ) : null}
      <Input
        aria-label="Search people"
        placeholder="Search people"
        value={query}
        className="h-8 text-sm"
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="max-h-40 overflow-y-auto rounded-md border border-border py-1">
        {users === null ? (
          <li className="px-2 py-1 text-xs text-muted-foreground">Searching…</li>
        ) : users.length === 0 ? (
          <li className="px-2 py-1 text-xs text-muted-foreground">No matching people</li>
        ) : (
          users.map((user) => (
            <li key={user.accountId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-state-hover"
                onClick={() => {
                  onChange(user);
                  setQuery("");
                }}
              >
                <Avatar user={user} />
                <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
