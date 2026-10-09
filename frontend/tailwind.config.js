/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        olive: {
          50: '#f5f8ed',
          100: '#e7f0d6',
          200: '#d0e2b2',
          300: '#b1cf86',
          400: '#91ba5d',
          500: '#73a03e',
          600: '#58802e',
          700: '#446426',
          800: '#385022',
          900: '#304420',
          950: '#17250e',
          primary: '#3B620C',
        },
        cream: {
          DEFAULT: '#F5F0E8',
          50: '#faf8f4',
          100: '#F5F0E8',
          200: '#ede4d2',
        },
      }
    },
  },
  plugins: [],
}

