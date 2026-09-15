import { lint, mapOf, PLACEHOLDER_CHAR } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import { describe, expect, it } from 'vitest'
import { flattenDocument } from '../src/dom-flatten.ts'

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('flattenDocument: what counts as prose', () => {
  it('extracts headings, paragraphs, list items and table cells', () => {
    const body = setBody(`
      <h1>A heading long enough to count</h1>
      <p>A paragraph of real page copy right here.</p>
      <ul><li>A list item with several words in it</li></ul>
      <table><tr><td>A table cell with several words</td></tr></table>
    `)
    const { blocks } = flattenDocument(body)
    expect(blocks.map((b) => `${b.kind}:${b.text}`)).toEqual([
      'heading:A heading long enough to count',
      'paragraph:A paragraph of real page copy right here.',
      'listItem:A list item with several words in it',
      'tableCell:A table cell with several words',
    ])
  })

  it('flattens inline elements so a tell spanning tags is still one sentence', () => {
    const body = setBody(
      `<p>Our platform <strong>doesn't just</strong> manage tasks, it's a workflow.</p>`,
    )
    const { blocks } = flattenDocument(body)
    expect(blocks[0]!.text).toBe("Our platform doesn't just manage tasks, it's a workflow.")
    const result = lint({ uri: 'live', format: 'html', blocks, directives: [] }, recommended)
    expect(result.flags.map((f) => f.ruleId)).toContain('not-just-x-its-y')
  })

  it('keeps a space between two adjacent text nodes split by an inline tag', () => {
    // "the cat " + <em>sat</em> + " down" must read as "the cat sat down", not "the catsat down".
    const body = setBody(`<p>the cat <em>sat</em> down on the mat today for a while</p>`)
    const { blocks } = flattenDocument(body)
    expect(blocks[0]!.text).toBe('the cat sat down on the mat today for a while')
  })

  it('collapses rendered whitespace the way a browser does', () => {
    const body = setBody(`<p>Text   split\n   across     lines and lots of extra space.</p>`)
    const { blocks } = flattenDocument(body)
    expect(blocks[0]!.text).toBe('Text split across lines and lots of extra space.')
  })

  it('skips script, style and hidden elements', () => {
    const body = setBody(`
      <script>const utilize = "we utilize a robust platform here";</script>
      <style>.a { content: "we utilize a robust platform"; }</style>
      <p hidden>We utilize a robust hidden platform right here today.</p>
      <p aria-hidden="true">We utilize a robust hidden platform right here today.</p>
      <p style="display:none">We utilize a robust hidden platform right here today.</p>
      <pre>we utilize a robust code sample right here today now</pre>
      <p>The only visible paragraph on the whole page right here.</p>
    `)
    const { blocks } = flattenDocument(body)
    expect(blocks.map((b) => b.text)).toEqual([
      'The only visible paragraph on the whole page right here.',
    ])
  })

  it('ignores blocks shorter than the minimum word count', () => {
    const body = setBody(`
      <p>Two words</p>
      <p>A sentence with more than four words in it here.</p>
    `)
    const { blocks } = flattenDocument(body)
    expect(blocks).toHaveLength(1)
  })

  it('never descends into its own overlay root', () => {
    const body = setBody(
      `<p>Real page copy that has plenty of its own words right here.</p><div id="vf-root"><p>We utilize a robust overlay platform internally here.</p></div>`,
    )
    const overlayRoot = body.querySelector('#vf-root')!
    const { blocks } = flattenDocument(body, { overlayRoot })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toContain('Real page copy')
  })

  it('respects extra skip selectors for vendor widgets', () => {
    const body = setBody(`
      <div class="cookie-banner"><p>We utilize cookies for a seamless experience here today.</p></div>
      <p>Our actual page copy lives right here in this paragraph.</p>
    `)
    const { blocks } = flattenDocument(body, { skipSelectors: ['.cookie-banner'] })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toContain('actual page copy')
  })
})

describe('flattenDocument: placeholders', () => {
  it('turns an inline code element into a placeholder that keeps the sentence shape', () => {
    const body = setBody(`<p>Run <code>npm install</code> to begin the whole process now.</p>`)
    const { blocks } = flattenDocument(body)
    expect(blocks[0]!.text).toBe(`Run ${PLACEHOLDER_CHAR} to begin the whole process now.`)
    const map = mapOf(blocks[0]!)
    const index = blocks[0]!.text.indexOf(PLACEHOLDER_CHAR)
    expect(map.isEditable(index, index + 1)).toBe(false)
  })

  it('turns an <img> into a placeholder', () => {
    const body = setBody(
      `<p>See the chart <img src="x.png" alt="a chart"> for the full picture right here.</p>`,
    )
    const { blocks } = flattenDocument(body)
    expect(blocks[0]!.text).toContain(PLACEHOLDER_CHAR)
  })
})

describe('flattenDocument: text refs', () => {
  it('records one TextRef per editable text segment, pointing at the real DOM Text node', () => {
    const body = setBody(`<p>We utilize a robust plan every single day for everyone here.</p>`)
    const { blocks, refs } = flattenDocument(body)
    const segment = blocks[0]!.segments.find((s) => s.kind === 'text')!
    const ref = refs[Number(segment.node!.path)]!
    expect(ref.node.data).toContain('We utilize a robust plan')
    expect(ref.node.parentElement?.tagName).toBe('P')
  })

  it('gives each text node its own ref, distinct across multiple blocks', () => {
    const body = setBody(`
      <p>First paragraph with plenty of its own words right here.</p>
      <p>Second paragraph with a totally different set of words.</p>
    `)
    const { refs } = flattenDocument(body)
    const nodes = new Set(refs.map((r) => r.node))
    expect(nodes.size).toBe(refs.length)
  })
})

describe('flattenDocument: nested blocks', () => {
  it('treats a <p> inside an <li> as its own separate block', () => {
    const body = setBody(
      `<ul><li>A list item wrapper<p>A nested paragraph with words here.</p></li></ul>`,
    )
    const { blocks } = flattenDocument(body)
    expect(blocks.map((b) => b.kind)).toEqual(['listItem', 'paragraph'])
  })
})
