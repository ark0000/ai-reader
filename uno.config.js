import { defineConfig, presetUno, presetTypography } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetTypography(),
  ],
  theme: {
    colors: {
      accent: 'var(--accent)',
      panel: 'var(--bg-panel)',
      text1: 'var(--text-1)',
      text2: 'var(--text-2)',
    }
  },
  content: {
    filesystem: [
      'src/static/**/*.html',
      'src/static/**/*.js',
    ]
  }
})
