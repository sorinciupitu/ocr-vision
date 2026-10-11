module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#f1f0fe",
          100: "#e6e3fd",
          200: "#cfcbfb",
          300: "#b0a8f8",
          400: "#8f80f3",
          500: "#6050e0",
          600: "#5140c9",
          700: "#4534ad",
          800: "#3a2d8d",
          900: "#322973",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
}
