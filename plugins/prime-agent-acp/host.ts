// alia-plugin-prime-agent-acp host entry
//
// Exports the ACP provider bridge. Vendored copy of the SDK bridge (SDK
// 0.4.47) patched with the prime-agent dialect -- see
// vendor/provider-bridge-acp.js and dialect/prime-agent-dialect.js. Switch
// back to a plain re-export of `@vesnalia/plugin-sdk/provider-bridge/acp` once
// VesnALIA exposes a dialect registry for provider plugins.
import {
  experimental_acpProviderBridge as experimental_providerBridge,
} from "./vendor/provider-bridge-acp.js";

export { experimental_providerBridge };
