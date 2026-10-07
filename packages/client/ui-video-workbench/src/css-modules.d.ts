declare module '*.module.css' {
  /** Typed escape hatch for CSS-module class imports; the class names are resolved by the bundler. */
  const classes: Record<string, string>
  export default classes
}
