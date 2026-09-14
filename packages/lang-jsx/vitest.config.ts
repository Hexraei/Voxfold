import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'jsx',
    include: ['test/**/*.test.ts'],
  },
})
