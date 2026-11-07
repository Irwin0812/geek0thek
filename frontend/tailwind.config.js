/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        night: {
          500: '#2a3348',
          600: '#1b2333',
          700: '#161d2b',
          800: '#121826',
          900: '#0c1120',
          950: '#080b13',
        },
        gold: {
          300: '#ecc989',
          400: '#e2b45f',
          500: '#d4a24e',
          600: '#c08c3b',
          700: '#a37430',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        fadein: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadein: 'fadein 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
