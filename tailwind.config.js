/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        pebble: {
          accent: '#6C63FF',
          'accent-soft': '#8B85FF',
          bg: '#1A1A2E',
          surface: '#16213E',
          'surface-2': '#1E2A4A',
          border: '#0F3460',
          text: '#E0E0E0',
          'text-dim': '#9E9E9E',
        },
      },
      fontFamily: {
        ui: ['Inter', 'system-ui', 'sans-serif'],
      },
      transitionDuration: { DEFAULT: '200ms' },
    },
  },
  plugins: [],
};
