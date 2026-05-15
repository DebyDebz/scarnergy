import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#EBF2FA",
          100: "#C5D9F0",
          500: "#2E86C1",
          700: "#1E3A5F",
          800: "#162D4A",
          900: "#0E1F34",
        },
        success: "#1E8449",
        warning: "#E67E22",
        danger:  "#C0392B",
      },
    },
  },
  plugins: [],
};

export default config;
