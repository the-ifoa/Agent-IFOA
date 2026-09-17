/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        'xs': '480px',
      },
      fontFamily: {
        sans: ['"DM Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Hanken Grotesk"', 'sans-serif'],
        heading: ['"Hanken Grotesk"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      maxWidth: {
        '7xl': '1280px',
        'container': '1280px',
      },
      borderRadius: {
        '3xl': '1.5rem', // 24px (Standard Cards)
        '2xl': '1rem',   // 16px (Input Fields & Dropdowns)
        'xl': '0.75rem', // 12px (Small Badges)
        'lg': '0.5rem',  // 8px (Small Badges)
      },
      colors: {
        // ── Brand & Accent Color: strictly rgb(52, 224, 110) / #34E06E ──
        brand: {
          DEFAULT: '#34E06E',
          hover:   '#34E06E',
          dark:    '#34E06E',
          light:   '#34E06E',
          xlight:  '#e8fbf0',
          muted:   '#f0fdf4',
          glow:    'rgba(52, 224, 110, 0.40)',
        },
        primary: {
          DEFAULT: '#34E06E',
          hover:   '#34E06E',
          dark:    '#34E06E',
          light:   '#34E06E',
          xlight:  '#e8fbf0',
          muted:   '#f0fdf4',
        },
        // ── Midnight & Slate 950 ────────────────────────────────
        midnight: {
          DEFAULT: '#020617',
          dark:    '#000021',
          card:    '#020617',
        },
        // ── Light Page Surfaces ─────────────────────────────────
        surface: {
          DEFAULT:   '#ffffff',
          soft:      '#f8f9fa',
          muted:     '#f1f5f9',
          low:       '#f8f9fa',
          container: '#f1f5f9',
        },
        // ── Text Palette ────────────────────────────────────────
        text: {
          main:   '#020617',
          muted:  '#475569',
          sub:    '#64748B',
          light:  '#94a3b8',
        },
        // ── Borders ─────────────────────────────────────────────
        border: {
          DEFAULT: '#e2e8f0',
          light:   'rgba(2, 6, 23, 0.08)',
          slate:   '#e2e8f0',
          dark:    'rgba(255, 255, 255, 0.10)',
        },
      },
      backgroundImage: {
        'brand-gradient':  'linear-gradient(135deg, #34E06E 0%, #34E06E 100%)',
        'midnight-gradient': 'linear-gradient(135deg, #020617 0%, #000021 100%)',
        'dark-gradient':   'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
      },
      boxShadow: {
        'brand-glow':    '0 0 20px rgba(52, 224, 110, 0.40)',
        'brand-glow-sm': '0 0 10px rgba(52, 224, 110, 0.25)',
        'ring-brand':    '0 0 0 3px rgba(52, 224, 110, 0.25)',
      },
    },
  },
  plugins: [],
}
