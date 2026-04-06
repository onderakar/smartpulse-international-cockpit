import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Mulish', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#0F766E',
          600: '#0D6D66',
          700: '#0A5B55',
          800: '#074A45',
          900: '#053B37',
        },
        dark: {
          600: '#414650',
          700: '#32363E',
          800: '#29333B',
          900: '#1E272E',
        },
        sp: {
          success: '#22C55E',
          warning: '#EAB308',
          danger: '#EF4444',
          info: '#04ADCF',
        },
        semantic: {
          bg: 'var(--color-bg)',
          surface: 'var(--color-surface)',
          'surface-alt': 'var(--color-surface-alt)',
          border: 'var(--color-border)',
          'border-subtle': 'var(--color-border-subtle)',
          text: 'var(--color-text)',
          'text-secondary': 'var(--color-text-secondary)',
          'text-muted': 'var(--color-text-muted)',
          'text-disabled': 'var(--color-text-disabled)',
          hover: 'var(--color-hover)',
        },
      },
      boxShadow: {
        'card': 'var(--shadow-card)',
        'dropdown': 'var(--shadow-dropdown)',
        'z1': 'var(--shadow-z1)',
      },
    },
  },
  plugins: [],
};

export default config;
