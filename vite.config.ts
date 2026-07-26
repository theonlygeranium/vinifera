import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

function productionSurfaceRoutes(): Plugin {
  const appEntry = "/app.html";

  return {
    name: "vinifera-production-surface-routes",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (
          pathname === "/app" ||
          pathname.startsWith("/app/") ||
          pathname === "/portal" ||
          pathname.startsWith("/portal/")
        ) {
          request.url = appEntry;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, "web"),
  plugins: [react(), tailwindcss(), productionSurfaceRoutes()],
  build: {
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, "dist"),
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "web/app.html"),
      },
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    sourcemap: false,
    target: "es2022",
  },
});
