import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";

// The browser client must target the same Supabase project as the /api functions,
// which use the integration-managed SUPABASE_URL. Prefer those values over any
// stale VITE_SUPABASE_* overrides so sign-in and email-code flows never split.
function resolveSupabaseClientEnv(mode) {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "",
    anonKey:
      env.SUPABASE_ANON_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      env.VITE_SUPABASE_ANON_KEY ||
      "",
  };
}

function resolveAppwriteClientEnv(mode) {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    endpoint: env.VITE_APPWRITE_ENDPOINT || process.env.VITE_APPWRITE_ENDPOINT || "",
    projectId: env.VITE_APPWRITE_PROJECT_ID || process.env.VITE_APPWRITE_PROJECT_ID || "",
    authProvider: env.VITE_AUTH_PROVIDER || process.env.VITE_AUTH_PROVIDER || "supabase",
  };
}

export default defineConfig(({ mode }) => {
  const supabaseClientEnv = resolveSupabaseClientEnv(mode);
  const appwriteClientEnv = resolveAppwriteClientEnv(mode);
  return {
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseClientEnv.url),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseClientEnv.anonKey),
    "import.meta.env.VITE_APPWRITE_ENDPOINT": JSON.stringify(appwriteClientEnv.endpoint),
    "import.meta.env.VITE_APPWRITE_PROJECT_ID": JSON.stringify(appwriteClientEnv.projectId),
    "import.meta.env.VITE_AUTH_PROVIDER": JSON.stringify(appwriteClientEnv.authProvider),
  },
  plugins: [
    react(),
    cloudflare(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router')) return 'vendor'
            if (id.includes('/react/') && !id.includes('react-dom') && !id.includes('react-router')) return 'vendor'
            if (id.includes('@tanstack')) return 'query'
            if (id.includes('@supabase')) return 'supabase'
            if (id.includes('framer-motion') || id.includes('next-themes')) return 'ui'
            if (id.includes('@heroicons') || id.includes('lucide-react')) return 'icons'
            if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod') || id.includes('input-otp')) return 'forms'
            if (id.includes('date-fns') || id.includes('class-variance-authority') || id.includes('clsx') || id.includes('tailwind-merge') || id.includes('react-markdown')) return 'util'
            if (id.includes('@radix-ui')) return 'radix'
          }
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  };
});
