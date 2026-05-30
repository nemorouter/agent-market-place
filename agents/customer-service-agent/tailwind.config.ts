import type { Config } from 'tailwindcss';

// darkMode 'class' → the widget stays in its light warm-sheet palette unless a
// `.dark` class is added (matches the screenshots; the component has dark: fallbacks).
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
