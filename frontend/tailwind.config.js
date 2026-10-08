/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Deep Observatory palette
        base:      '#0E1419',   // deepest background
        surface:   '#131A22',   // sidebar
        panel:     '#1B242E',   // cards
        panel2:    '#232F3B',   // hover
        border:    '#2A3742',   // soft border
        border2:   '#38475A',   // stronger border
        primary:   '#FFB454',   // warm amber
        primary2:  '#FFC47A',
        teal:      '#5CC8D6',   // secondary accent
        danger:    '#E85A6B',
        success:   '#6FCF97',
        warning:   '#FFB454',
        text:      '#E8EEF5',
        muted:     '#9AA7B6',
        dim:       '#6B7887',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 4px 24px rgba(0,0,0,0.4)',
        glow: '0 0 24px rgba(255,180,84,0.25)',
      },
    },
  },
  plugins: [],
}