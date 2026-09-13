import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'html',
    include: ['test/**/*.test.ts'],
  },
})
