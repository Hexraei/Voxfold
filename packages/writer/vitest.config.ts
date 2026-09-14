import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'writer',
    include: ['test/**/*.test.ts'],
  },
})
