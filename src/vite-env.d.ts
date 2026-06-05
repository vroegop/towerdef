/* Ambient types for Vite's `import.meta.env`. tsconfig pins `types: ["node"]` (no vite/client), so we
   declare just the env keys we read here rather than pulling Vite's whole client typings in. */

interface ImportMetaEnv {
  /** Base URL of the real backend. Unset (the default, and on GitHub Pages) → the in-browser
      MockBackend is used. Set it (e.g. https://api.example.com) → the fetch-based HttpBackend. */
  readonly VITE_BACKEND_URL?: string;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
