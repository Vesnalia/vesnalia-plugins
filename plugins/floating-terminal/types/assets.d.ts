// Stylesheets are side-effect imports handled by esbuild during
// `alia plugin build`; they carry no TypeScript shape.
declare module "*.css";
