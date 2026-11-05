import { describe, it, expect } from 'vitest'
import pkg from '../../package.json'

describe('package', () => {
  it('is published as @mapcentia/gc2-sdk with gc2-sdk entry files', () => {
    expect(pkg.name).toBe('@mapcentia/gc2-sdk')
    expect(pkg.main).toBe('./dist/gc2-sdk.cjs')
    expect((pkg.exports as any)['./node'].import.default).toBe('./dist/gc2-sdk-node.js')
  })
})
