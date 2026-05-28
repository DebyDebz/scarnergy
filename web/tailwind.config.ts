import type { Config } from "tailwindcss";

// Dark navy blue palette derived from the mobile app's primary #1E3A5F
const navyBlue = {
  50:  "#eef2f7",
  100: "#d4e0ec",
  200: "#a9c1d9",
  300: "#7ca0c3",
  400: "#5180ad",
  500: "#316290",
  600: "#1E3A5F", // mobile app primary
  700: "#162d49",
  800: "#0f1f33",
  900: "#07111c",
  950: "#040a12",
};

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Override indigo and purple with the dark navy blue from the mobile app
        indigo: navyBlue,
        purple: navyBlue,
      },
    },
  },
  plugins: [],
};
export default config;
