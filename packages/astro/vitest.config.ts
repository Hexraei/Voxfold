import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'astro-integration',
    include: ['test/**/*.test.ts'],
  },
})
