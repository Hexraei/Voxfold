import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'svelte',
    include: ['test/**/*.test.ts'],
  },
})
