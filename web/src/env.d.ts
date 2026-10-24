// CSS Modules: esbuild's local-css loader scopes the class names.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
declare module '*.css';
