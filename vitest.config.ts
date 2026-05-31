import { defineConfig } from 'vitest/config';

// Unit tests cover the deterministic simulation (sim/*). They run in a plain Node
// environment — the sim has no DOM/canvas dependencies by design — which keeps them fast.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
  },
});
