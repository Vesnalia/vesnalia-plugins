import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validate a skill directory / frontmatter name. */
export function assertSkillName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    throw new Error("Skill name must be 1–64 characters.");
  }
  if (!NAME_RE.test(trimmed)) {
    throw new Error(
      "Skill name must be lowercase letters, numbers, and single hyphens.",
    );
  }
  return trimmed;
}

export function skillMarkdown(args: {
  name: string;
  description: string;
  body?: string;
}): string {
  const description = args.description.trim() || `Skill ${args.name}.`;
  if (description.length > 1024) {
    throw new Error("Description must be at most 1024 characters.");
  }
  const body =
    args.body?.trim() ||
    `# ${args.name}\n\nDescribe when to use this skill and the steps to follow.\n`;
  return `---\nname: ${args.name}\ndescription: ${description}\n---\n\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

export async function createUserSkill(args: {
  dataDir: string;
  name: string;
  description: string;
  body?: string;
}): Promise<{ name: string; filePath: string }> {
  const name = assertSkillName(args.name);
  const dir = path.join(args.dataDir, "skills", name);
  const filePath = path.join(dir, "SKILL.md");
  try {
    await access(dir);
    throw new Error(`Skill "${name}" already exists at ${dir}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(
    filePath,
    skillMarkdown({
      name,
      description: args.description,
      body: args.body,
    }),
    "utf8",
  );
  return { name, filePath };
}
