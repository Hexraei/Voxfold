import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'vue',
    include: ['test/**/*.test.ts'],
  },
})
