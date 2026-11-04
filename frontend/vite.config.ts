/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    globals: true,
    // themeTokens.ts parses tokens.css (imported with ?raw) at load time;
    // vitest stubs CSS to "" unless the file is included here.
    css: { include: [/tokens\.css/] },
  },
});
