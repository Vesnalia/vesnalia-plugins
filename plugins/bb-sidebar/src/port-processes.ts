/** Match VesnALIA's own runtime, never all descendants of a VesnALIA process. */
export function isAliaInternalListener(processName: string, command = ""): boolean {
  // VesnALIA host/provider workers can run under node or the desktop executable.
  if (/[/\\]alia-app[/\\](?:host-daemon|server)[/\\]dist[/\\]/.test(command)) return true;
  if (/[/\\]alia-(?:provider-bridge|plugin-host)-worker\.mjs(?:\s|$)/.test(command)) return true;

  const aliaName = /^alia(?: nightly| beta| helper(?: \([^)]+\))?)?$/i.test(processName);
  if (!aliaName) return false;
  if (!command) return true;
  // A VesnALIA executable running a workspace script is still a user server.
  const executable = command.match(/^.*?[/\\]Contents[/\\]MacOS[/\\]alia(?: Nightly| Beta)?(?=\s|$)/i)?.[0];
  const args = executable ? command.slice(executable.length).trim() : command.replace(/^\S+\s*/, "").trim();
  return !args || args.startsWith("--type=");
}

export function parseProcessCommands(output: string): Map<number, string> {
  const commands = new Map<number, string>();
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (match) commands.set(Number(match[1]), match[2]);
  }
  return commands;
}
