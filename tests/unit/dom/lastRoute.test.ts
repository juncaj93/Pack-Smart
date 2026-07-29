// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readLastRoute, writeLastRoute } from '@/lib/lastRoute'

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('last route persistence', () => {
  it('returns null before anything has been stored', () => {
    expect(readLastRoute()).toBeNull()
  })

  it('round-trips a known tab', () => {
    writeLastRoute('/my-stuff')
    expect(readLastRoute()).toBe('/my-stuff')
  })

  it('ignores paths that are not tabs, so a deep link never becomes the resume target', () => {
    writeLastRoute('/trips/42/checklist')
    expect(readLastRoute()).toBeNull()
  })

  it('discards a stored value that is no longer a valid tab', () => {
    window.localStorage.setItem('pack-smart:last-route', '/clothing')
    expect(readLastRoute()).toBeNull()
  })

  it('degrades quietly when storage is unavailable', () => {
    // Private mode, or a store the browser has evicted. Resuming is a nicety;
    // it must never surface as an error.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => writeLastRoute('/settings')).not.toThrow()
    expect(readLastRoute()).toBeNull()
  })
})
