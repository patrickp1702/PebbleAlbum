/**
 * tailwind.config.js — maps the app-chrome tokens (CSS variables declared in
 * src/style.css) into Tailwind utilities. The historical `pebble-*` names are
 * kept and re-pointed at the semantic tokens so existing classes keep working;
 * new names (`hover`, `pressed`, `border-strong`, `success`, …) fill the gaps.
 * Change a colour in style.css, never here.
 */
const token = (name) => `rgb(var(--ui-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        pebble: {
          // Surfaces (back → front).
          bg: token('canvas'),
          surface: token('panel'),
          'surface-2': token('raised'),
          hover: token('hover'),
          pressed: token('pressed'),
          border: token('border'),
          'border-strong': token('border-strong'),
          // Text.
          text: token('text'),
          'text-dim': token('text-dim'),
          'text-off': token('text-off'),
          // Accent. `accent` is a FILL; `accent-soft` is the accent as text/icon.
          accent: token('accent'),
          'accent-hover': token('accent-hover'),
          'accent-pressed': token('accent-pressed'),
          'accent-soft': token('accent-text'),
          'on-accent': token('on-accent'),
          // Semantic.
          success: token('success'),
          warning: token('warning'),
          danger: token('danger'),
          'danger-fill': token('danger-fill'),
        },
      },
      fontFamily: {
        ui: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      // Type scale: 11 (2xs, the floor) · 12 (xs) · 13 (sm) · 14 (base) · 16 · 20 · 24 · 30.
      fontSize: {
        '2xs': ['11px', { lineHeight: '15px' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
        lg: ['16px', { lineHeight: '22px' }],
        xl: ['20px', { lineHeight: '26px' }],
        '2xl': ['24px', { lineHeight: '30px' }],
        '3xl': ['30px', { lineHeight: '36px' }],
        '4xl': ['36px', { lineHeight: '42px' }],
      },
      // Radius scale: tight, tool-like. Controls 6, cards 8, dialogs 12.
      borderRadius: {
        sm: '3px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
      },
      boxShadow: {
        pop: 'var(--ui-shadow-pop)',
        modal: 'var(--ui-shadow-modal)',
      },
      transitionDuration: { DEFAULT: '120ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.2, 0, 0, 1)' },
    },
  },
  plugins: [],
};
