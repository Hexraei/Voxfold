import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'next',
    include: ['test/**/*.test.ts'],
  },
})
