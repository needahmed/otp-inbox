import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}", "./success.html"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
