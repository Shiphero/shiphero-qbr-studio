/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sh-navy': '#252F3E',
        'sh-blue': '#4472E8',
        'sh-gold': '#F5A623',
        'sh-light': '#F5F5F0',
        'sh-red': '#E05252',
      },
      fontFamily: {
        'nunito': ['Nunito', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
