/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          950: '#0a0b0d',
          900: '#101216',
          800: '#16181d',
          700: '#1f2228',
          600: '#2a2e36',
          400: '#6b7280',
          300: '#9aa1ab',
          200: '#c6cbd3',
          100: '#e8eaee',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
