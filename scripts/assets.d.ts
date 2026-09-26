// esbuild loads these as plain strings (see scripts/build.mjs).
declare module '*.svg' {
  const markup: string;
  export default markup;
}
declare module '*.css' {
  const css: string;
  export default css;
}
