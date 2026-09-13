import { describe, expect, it } from 'vitest'
import { ENGINE_NAME } from '../src/index'

describe('@voxfold/core skeleton', () => {
  it('exports the engine name', () => {
    expect(ENGINE_NAME).toBe('voxfold')
  })
})
