import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith(".css"))
            ? "assets/app.css"
            : "assets/[name][extname]",
      },
    },
  },
});
