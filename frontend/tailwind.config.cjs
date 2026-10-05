/** @type {import('tailwindcss').Config} */

// Colors resolve through CSS variables (rgb triplets) so a single class
// adapts to the active theme while keeping Tailwind opacity modifiers (/90 …) working.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        np: {
          bg:      v("--np-bg"),
          panel:   v("--np-panel"),
          border:  v("--np-border"),
          accent:  v("--np-accent"),
          green:   v("--np-green"),
          red:     v("--np-red"),
          amber:   v("--np-amber"),
          muted:   v("--np-muted"),
          text:    v("--np-text"),
          violet:  v("--np-violet"),
          cyan:    v("--np-cyan"),
        }
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
      },
      animation: {
        "fade-in": "fadeIn 0.35s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float": "float 6s ease-in-out infinite",
        "float-slow": "float 9s ease-in-out infinite",
        "spin-slow": "spin 14s linear infinite",
        "shimmer-x": "shimmerX 2.4s linear infinite",
        "ping-slow": "pingSoft 2.4s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
        shimmerX: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pingSoft: {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "80%, 100%": { transform: "scale(2.4)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
}
