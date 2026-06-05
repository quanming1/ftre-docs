/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: 'var(--ftre-bg-base)',
        surface: 'var(--ftre-bg-surface)',
        elevated: 'var(--ftre-bg-elevated)',
        panel: 'var(--ftre-bg-panel)',
        hover: 'var(--ftre-bg-hover)',
        'active-doc': 'var(--ftre-bg-active-doc)',
        border: 'var(--ftre-border-default)',
        'border-subtle': 'var(--ftre-border-subtle)',
        neon: 'var(--ftre-accent-default)',
        'neon-hover': 'var(--ftre-accent-hover)',
        't-primary': 'var(--ftre-text-primary)',
        't-secondary': 'var(--ftre-text-secondary)',
        't-muted': 'var(--ftre-text-muted)',
        't-dim': 'var(--ftre-text-dim)',
        't-ghost': 'var(--ftre-text-ghost)',
      },
      fontFamily: {
        mono: ['var(--font-mono)'],
        sans: ['var(--font-sans)'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
