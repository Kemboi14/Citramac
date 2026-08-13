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
    },
  },
  plugins: [],
};
