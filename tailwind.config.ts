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
        // 啪叽主色调占位
        paji: {
          50: "#fff8f0",
          100: "#ffecd4",
          200: "#ffd49e",
          300: "#ffb968",
          400: "#ff9f3d",
          500: "#ff7b1a",
          600: "#f05a00",
          700: "#c74300",
          800: "#9e3508",
          900: "#7f2d0d",
        },
      },
    },
  },
  plugins: [],
};

export default config;
