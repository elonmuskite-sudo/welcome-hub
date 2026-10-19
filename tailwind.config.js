import tailwindcssAnimate from 'tailwindcss-animate'

const config = {
  darkMode: ["class"],
  // Every source file has to be scanned. Tailwind tree-shakes the custom
  // classes declared in `@layer components` (src/index.css) against these
  // globs, so a directory missing here silently deletes real CSS in
  // production — e.g. `.chat-shell` (used only by src/layouts/ChatLayout.jsx)
  // and `.keyboard-open` (toggled from src/hooks/useViewportInsets.js) were
  // dropped, which let the chat column grow without a height limit and pushed
  // the message composer off-screen after a few messages.
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'],
        mono: ['Consolas', 'Monaco', 'Courier New', 'monospace'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        badge: {
          blue: "hsl(var(--badge-blue))",
          gold: "hsl(var(--badge-gold))",
        },
      },
      textColor: {
        'font-primary': 'var(--font-color-primary, #1f2937)',
        'font-secondary': 'var(--font-color-secondary, #4b5563)',
        'font-accent': 'var(--font-color-accent, #3b82f6)',
        'font-muted': 'var(--font-color-muted, #9ca3af)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}

export default config
