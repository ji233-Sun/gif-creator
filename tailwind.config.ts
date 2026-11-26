import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/ui/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paji: {
          50: "#fff0f5",
          100: "#ffe2ec",
          200: "#fac5d8",
          300: "#f6a5c1",
          400: "#f36b99",
          500: "#e85b8c",
          action: "#c83c71",
          600: "#c83c71",
          700: "#a72d5c",
          800: "#8b294e",
          900: "#742544",
        },
        sky: {
          50: "#edf8ff",
          100: "#d7effb",
          200: "#b1def4",
          300: "#85cce9",
          400: "#58b6e1",
          500: "#369bc9",
          600: "#287fa9",
          700: "#246689",
          800: "#245672",
          900: "#22485f",
        },
        canvas: "var(--background)",
        surface: "var(--surface)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        line: "var(--line)",
      },
    },
  },
  plugins: [],
};

export default config;
