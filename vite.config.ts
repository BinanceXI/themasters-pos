import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));
const appVersion = String(pkg?.version || "");

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL;

  return {
    ...(mode ? { envPrefix: "VITE_" } : {}),
    server: {
      host: "::",
      port: 8080,
      strictPort: true, // ✅ IMPORTANT: do NOT auto-switch ports
      ...(command === "serve" && supabaseUrl
        ? {
            proxy: {
              // DEV-server proxy to avoid CORS while calling Supabase Edge Functions from localhost.
              "/functions/v1": {
                target: supabaseUrl,
                changeOrigin: true,
                secure: true,
              },
            },
          }
        : {}),
    },
    plugins: [react(), command === "serve" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || ""),
    },
    build: {
      sourcemap: true,
    },
  };
});
