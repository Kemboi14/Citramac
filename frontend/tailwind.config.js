/** @type {import('tailwindcss').Config} */
// Colors/fonts/radii map straight onto the CSS custom properties defined in
// src/theme/tokens.css, which itself is the exact token set from
// docs/03-DESIGN-SYSTEM.md §3.1 — do not add colors here that aren't backed
// by a token in that file.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // Colors are CSS-var-driven (see tokens.css) so dark mode never needs a
  // `dark:` utility for them, but this still lets a `dark:` prefix be used
  // for anything else (image filters, shadow intensity) and matches the
  // `data-theme="dark"` attribute frontend/src/theme/useTheme.ts sets.
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: "var(--green)",
          "green-dark": "var(--green-dark)",
          "green-tint": "var(--green-tint)",
          "green-tint-2": "var(--green-tint-2)",
        },
        // Foreground for a solid brand/status fill — never `text-white`,
        // which breaks the moment a theme picks a light primary.
        on: {
          primary: "var(--on-green)",
          status: "var(--on-status)",
        },
        status: {
          red: "var(--red)",
          "red-tint": "var(--red-tint)",
          "red-strong": "var(--red-strong)",
          amber: "var(--amber)",
          "amber-tint": "var(--amber-tint)",
        },
        priority: {
          red: "var(--pri-red)",
          "red-tint": "var(--pri-red-tint)",
          "red-solid": "var(--pri-red-solid)",
          orange: "var(--pri-orange)",
          "orange-tint": "var(--pri-orange-tint)",
          "orange-solid": "var(--pri-orange-solid)",
          yellow: "var(--pri-yellow)",
          "yellow-tint": "var(--pri-yellow-tint)",
          "yellow-solid": "var(--pri-yellow-solid)",
          green: "var(--pri-green)",
          "green-tint": "var(--pri-green-tint)",
          "green-solid": "var(--pri-green-solid)",
        },
        accent: {
          info: "var(--info)",
          "info-tint": "var(--info-tint)",
          violet: "var(--violet)",
          "violet-tint": "var(--violet-tint)",
        },
        sidebar: {
          text: "var(--sidebar-text)",
          "text-strong": "var(--sidebar-text-strong)",
          muted: "var(--sidebar-muted)",
          "active-bg": "var(--sidebar-active-bg)",
          "active-text": "var(--sidebar-active-text)",
          hover: "var(--sidebar-hover)",
          divider: "var(--sidebar-divider)",
        },
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
          6: "var(--chart-6)",
        },
        ink: {
          900: "var(--ink-900)",
          700: "var(--ink-700)",
          500: "var(--ink-500)",
          400: "var(--ink-400)",
          300: "var(--ink-300)",
        },
        surface: {
          bg: "var(--bg)",
          card: "var(--card)",
          border: "var(--border)",
          scrim: "var(--scrim-overlay)",
        },
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
      },
      fontFamily: {
        display: ["Lexend", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.92)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "grow-up": {
          from: { transform: "scaleY(0)" },
          to: { transform: "scaleY(1)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-4px)" },
          "40%, 80%": { transform: "translateX(4px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "scale-in": "scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        "grow-up": "grow-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        shake: "shake 0.4s ease-in-out",
      },
    },
  },
  plugins: [],
};
