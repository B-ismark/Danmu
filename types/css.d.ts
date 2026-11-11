// Global stylesheets are imported for their side effect (app/layout.tsx imports
// globals.css). TypeScript 6 checks side-effect imports by default
// (noUncheckedSideEffectImports), and Next declares only *.module.css, so a plain
// stylesheet needs this. CSS modules keep Next's typed declaration.
declare module '*.css';
