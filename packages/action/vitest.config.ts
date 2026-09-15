import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'action',
    include: ['test/**/*.test.ts'],
  },
})
