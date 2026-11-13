/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
      },
      // Single layer scale: nav 40, drawer 60, modal 70, confirm 80, toast 100.
      zIndex: {
        nav: '40',
        drawer: '60',
        modal: '70',
        confirm: '80',
        toast: '100',
      },
    },
  },
  plugins: [],
};
