import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'vite',
    include: ['test/**/*.test.ts'],
  },
})
