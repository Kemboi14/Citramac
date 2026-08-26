/** @type {import('tailwindcss').Config} */
// Colors/fonts/radii map straight onto the CSS custom properties defined in
// src/theme/tokens.css, which itself is the exact token set from
// docs/03-DESIGN-SYSTEM.md §3.1 — do not add colors here that aren't backed
// by a token in that file.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          green: "var(--green)",
          "green-dark": "var(--green-dark)",
          "green-tint": "var(--green-tint)",
          "green-tint-2": "var(--green-tint-2)",
        },
        status: {
          red: "var(--red)",
          "red-tint": "var(--red-tint)",
          amber: "var(--amber)",
          "amber-tint": "var(--amber-tint)",
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
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "scale-in": "scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        "grow-up": "grow-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
