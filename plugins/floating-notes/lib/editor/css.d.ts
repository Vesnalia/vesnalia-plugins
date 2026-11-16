/**
 * Lets `import "./editor.css"` type-check; the actual CSS is inlined by the
 * esbuild bundle (`alia plugin build`).
 */
declare module "*.css";
