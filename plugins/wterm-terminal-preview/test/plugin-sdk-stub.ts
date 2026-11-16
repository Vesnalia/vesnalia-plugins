// The standalone source imports VesnALIA's host-provided package name. Tests bridge
// that name to the published SDK implementation without depending on a sibling
// workspace checkout.
export { defineRpcContract } from "@vesnalia/plugin-sdk";
