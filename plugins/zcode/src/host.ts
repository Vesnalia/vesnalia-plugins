import { experimental_defineProviderBridge } from "@vesnalia/plugin-sdk/provider-bridge";
import { createBridge } from "./bridge.js";

const bridge = createBridge(); // No child or I/O until a request arrives.
export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine: bridge.handleLine,
  onClose: () => {
    void bridge.close();
  },
  onSigterm: () => {
    void bridge.close();
  },
  onSigint: () => {
    void bridge.close();
  },
});
