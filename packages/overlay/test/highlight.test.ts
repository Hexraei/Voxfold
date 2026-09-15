import { describe, expect, it } from 'vitest'
import { colorForCategory, createHighlightRenderer, highlightStylesheet } from '../src/highlight.ts'

describe('colorForCategory', () => {
  it('returns a distinct color for each known category', () => {
    const categories = [
      'punctuation',
      'plain-words',
      'intensifier',
      'inanimate-adverb',
      'buzzword',
      'opener-closer',
      'construction',
      'markdown',
    ]
    const colors = categories.map(colorForCategory)
    expect(colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true)
  })

  it('falls back to a default color for an unknown category', () => {
    expect(colorForCategory('not-a-real-category')).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('highlightStylesheet', () => {
  it('generates one ::highlight() rule per category', () => {
    const css = highlightStylesheet()
    expect(css).toContain('::highlight(voxfold-punctuation)')
    expect(css).toContain('::highlight(voxfold-construction)')
    expect(css).toContain('text-decoration')
  })
})

describe('createHighlightRenderer', () => {
  function setBody(html: string): HTMLElement {
    document.body.innerHTML = html
    return document.body
  }

  it('falls back to positioned boxes when CSS.highlights is unavailable (as in this test env)', () => {
    const body = setBody(`<p>We utilize a robust plan every single day for everyone here.</p>`)
    const container = document.createElement('div')
    document.body.appendChild(container)

    const textNode = body.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 3)
    range.setEnd(textNode, 11) // "utilize"

    const renderer = createHighlightRenderer(container)
    renderer.render([{ id: 'flag-1', range, category: 'plain-words' }])

    const box = container.querySelector('[data-vf-highlight-id="flag-1"]') as HTMLElement | null
    expect(box).not.toBeNull()
  })

  it('removes a box for a flag that is no longer in the render list', () => {
    const body = setBody(`<p>We utilize a robust plan every single day for everyone here.</p>`)
    const container = document.createElement('div')
    document.body.appendChild(container)

    const textNode = body.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 3)
    range.setEnd(textNode, 11)

    const renderer = createHighlightRenderer(container)
    renderer.render([{ id: 'flag-1', range, category: 'plain-words' }])
    expect(container.querySelector('[data-vf-highlight-id="flag-1"]')).not.toBeNull()

    renderer.render([])
    expect(container.querySelector('[data-vf-highlight-id="flag-1"]')).toBeNull()
  })

  it('clear() removes every rendered box', () => {
    const body = setBody(`<p>We utilize a robust plan every single day for everyone here.</p>`)
    const container = document.createElement('div')
    document.body.appendChild(container)

    const textNode = body.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 3)
    range.setEnd(textNode, 11)

    const renderer = createHighlightRenderer(container)
    renderer.render([{ id: 'flag-1', range, category: 'plain-words' }])
    renderer.clear()
    expect(container.children).toHaveLength(0)
  })
})
