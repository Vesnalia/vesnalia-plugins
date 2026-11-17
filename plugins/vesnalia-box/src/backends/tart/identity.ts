import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupDir } from "../setup-dir.ts";
import { PRODUCT } from "../../brand.ts";

export const IDENTITY_DAEMON = "dev.alia-box.identity";
const TOOL_END = "ALIABOX_IDENTITY_TOOL";
const PLIST_END = "ALIABOX_IDENTITY_PLIST";
const INSTALL_END = "ALIABOX_IDENTITY_INSTALL";

let tool: string | null = null;

export function macosIdentityTool(): string {
  tool ??= readFileSync(join(setupDir(), "tart", "guest", "alia-box-identity-macos.sh"), "utf8");
  return tool;
}

export function identityDaemonPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${IDENTITY_DAEMON}</string>
<key>ProgramArguments</key><array><string>/usr/local/sbin/alia-box-identity</string><string>boot</string></array>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>/var/log/alia-box-identity.log</string>
<key>StandardErrorPath</key><string>/var/log/alia-box-identity.log</string>
</dict></plist>
`;
}

export function identityInstallScript(text = macosIdentityTool()): string {
  for (const end of [TOOL_END, PLIST_END, INSTALL_END]) if (text.includes(end)) throw new Error(`The identity tool holds ${end}, which ends its heredoc.`);
  return `case "$(sysctl -n hw.model 2>/dev/null)" in VirtualMac*) ;; *) echo "not a VM"; exit 0 ;; esac
sudo -n /bin/sh -s <<'${INSTALL_END}'
set -e
mkdir -p /usr/local/sbin /usr/local/lib/${PRODUCT}
cat > /usr/local/sbin/alia-box-identity.new <<'${TOOL_END}'
${text.endsWith("\n") ? text : `${text}\n`}${TOOL_END}
chmod 755 /usr/local/sbin/alia-box-identity.new
mv -f /usr/local/sbin/alia-box-identity.new /usr/local/sbin/alia-box-identity
cat > /Library/LaunchDaemons/${IDENTITY_DAEMON}.plist.new <<'${PLIST_END}'
${identityDaemonPlist()}${PLIST_END}
chown root:wheel /Library/LaunchDaemons/${IDENTITY_DAEMON}.plist.new
chmod 644 /Library/LaunchDaemons/${IDENTITY_DAEMON}.plist.new
mv -f /Library/LaunchDaemons/${IDENTITY_DAEMON}.plist.new /Library/LaunchDaemons/${IDENTITY_DAEMON}.plist
/usr/local/sbin/alia-box-identity enable
[ -e /var/run/alia-box-identity/boot ] || /usr/local/sbin/alia-box-identity boot >/dev/null
echo installed
${INSTALL_END}`;
}
