import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'edit-server',
    include: ['test/**/*.test.ts'],
  },
})
