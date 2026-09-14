import { applyFixes, lint, mapOf, PLACEHOLDER_CHAR, type ProseDocument } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import { describe, expect, it } from 'vitest'
import { htmlAdapter, isClientRenderedShell } from '../src/index'

const extract = (html: string, uri = 'page.html') =>
  htmlAdapter.extract(html, { uri }) as ProseDocument

const texts = (html: string) => extract(html).blocks.map((block) => block.text)

describe('html adapter: what counts as page copy', () => {
  it('extracts headings, paragraphs, list items and table cells', () => {
    const blocks = extract(`<html><body>
      <h1>A heading long enough to count</h1>
      <p>A paragraph of real page copy.</p>
      <ul><li>A list item with several words</li></ul>
      <table><tr><td>A table cell with words</td></tr></table>
    </body></html>`).blocks
    expect(blocks.map((b) => `${b.kind}:${b.text}`)).toEqual([
      'heading:A heading long enough to count',
      'paragraph:A paragraph of real page copy.',
      'listItem:A list item with several words',
      'tableCell:A table cell with words',
    ])
  })

  it('skips scripts, styles, hidden elements and code blocks', () => {
    expect(
      texts(`<body>
        <script>const utilize = "we utilize a robust platform here";</script>
        <style>.a { content: "we utilize a robust platform"; }</style>
        <p hidden>We utilize a robust hidden platform.</p>
        <p aria-hidden="true">We utilize a robust aria-hidden platform.</p>
        <p style="display:none">We utilize a robust styled platform.</p>
        <pre>we utilize a robust code sample</pre>
        <p>The only visible paragraph on the page.</p>
      </body>`),
    ).toEqual(['The only visible paragraph on the page.'])
  })

  it('skips cookie banners and chat widgets, whose words belong to a vendor', () => {
    expect(
      texts(`<body>
        <div class="cookie-banner"><p>We utilize cookies to deliver a seamless experience.</p></div>
        <div id="intercom-container"><p>Say goodbye to slow support, we are here to help.</p></div>
        <p>Our actual page copy lives here.</p>
      </body>`),
    ).toEqual(['Our actual page copy lives here.'])
  })

  it('ignores blocks too short to judge, such as nav labels and buttons', () => {
    expect(
      texts(`<body>
        <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
        <button>Buy</button>
        <p>A sentence with more than four words.</p>
      </body>`),
    ).toEqual(['A sentence with more than four words.'])
  })

  it('weights footer and legal copy at half', () => {
    const document = extract(`<body>
      <main><p>Main copy that we utilize heavily.</p></main>
      <footer><p>Footer copy that we utilize heavily.</p></footer>
    </body>`)
    expect(document.blocks.map((b) => `${b.context.region}:${b.context.weight}`)).toEqual([
      'main:1',
      'footer:0.5',
    ])

    const flags = lint(document, recommended).flags
    expect(flags[0]!.contribution).toBe(flags[1]!.contribution * 2)
  })
})

describe('html adapter: flattening and offsets', () => {
  it('flattens inline tags so a tell spanning them is one sentence', () => {
    const document = extract(
      "<body><p>Our platform <strong>doesn't just</strong> manage tasks, it's a workflow.</p></body>",
    )
    expect(document.blocks[0]!.text).toBe(
      "Our platform doesn't just manage tasks, it's a workflow.",
    )
    expect(lint(document, recommended).flags.map((f) => f.ruleId)).toContain('not-just-x-its-y')
  })

  it('collapses rendered whitespace the way a browser does', () => {
    expect(texts('<body><p>Text   split\n   across     lines and spaces.</p></body>')).toEqual([
      'Text split across lines and spaces.',
    ])
  })

  it('turns inline code and images into placeholders', () => {
    const document = extract('<body><p>Run <code>npm i</code> to install it now.</p></body>')
    expect(document.blocks[0]!.text).toBe(`Run ${PLACEHOLDER_CHAR} to install it now.`)
    const index = document.blocks[0]!.text.indexOf(PLACEHOLDER_CHAR)
    expect(mapOf(document.blocks[0]!).isEditable(index, index + 1)).toBe(false)
  })

  it('maps every character back to the identical source character', () => {
    const check = (html: string) => {
      const document = extract(html)
      for (const block of document.blocks) {
        const map = mapOf(block)
        for (let i = 0; i < block.text.length; i++) {
          if (map.segmentAt(i)?.kind !== 'text') continue
          const offset = map.toSource(i, 'start')
          expect(offset).toBeDefined()
          // Collapsed whitespace maps to the first character of the run it replaced.
          if (block.text[i] === ' ') continue
          expect(html[offset!]).toBe(block.text[i])
        }
      }
    }
    check('<body><p>Plain copy with <em>emphasis</em> and <b>bold</b> in it.</p></body>')
    check('<body><p>Curly quotes “it doesn’t” and an em dash — here.</p></body>')
    check('<body><p>Emoji 🚀 and astral 𐀀 characters inside the copy.</p></body>')
    check('<body>\r\n<p>Windows line\r\nendings in the markup.</p>\r\n</body>')
  })

  it('reports source ranges that slice back to the flagged text', () => {
    const html = '<body><p>We <b>utilize</b> a robust platform that empowers teams.</p></body>'
    const document = extract(html)
    const flags = lint(document, recommended).flags
    expect(flags.length).toBeGreaterThan(0)
    for (const flag of flags) {
      const rebuilt = flag.sourceRanges.map((r) => html.slice(r.start, r.end)).join('')
      expect(rebuilt).toBe(flag.text)
    }
  })

  it('decodes entities and keeps later offsets aligned', () => {
    const html = '<body><p>Tom &amp; Jerry utilize a robust platform daily.</p></body>'
    const document = extract(html)
    expect(document.blocks[0]!.text).toBe('Tom & Jerry utilize a robust platform daily.')
    const flag = lint(document, recommended).flags.find((f) => f.ruleId === 'utilize')!
    expect(html.slice(flag.sourceRanges[0]!.start, flag.sourceRanges[0]!.end)).toBe('utilize')
  })
})

describe('html adapter: directives', () => {
  it('reads voxfold-disable comments from HTML comments', () => {
    const html =
      '<body>\n<!-- voxfold-disable-next-line utilize -->\n<p>We utilize it here now.</p>\n</body>'
    const document = extract(html)
    expect(document.directives[0]?.type).toBe('disable-next-line')
    expect(lint(document, recommended).flags.filter((f) => f.ruleId === 'utilize')).toHaveLength(0)
  })
})

describe('html adapter: client-rendered pages', () => {
  it('detects an empty SPA shell rather than scoring it as clean', () => {
    const shell = `<html><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>`
    expect(isClientRenderedShell(shell, extract(shell))).toBe(true)
  })

  it('does not mistake a real server-rendered page for a shell', () => {
    const page = `<html><body><div id="root"><p>This page has plenty of real server-rendered copy on it, enough to lint properly.</p></div><script type="module" src="/main.js"></script></body></html>`
    expect(isClientRenderedShell(page, extract(page))).toBe(false)
  })
})

describe('html adapter: a realistic landing page', () => {
  it('separates marketing copy from plain copy', () => {
    const marketing = `<html><body><main>
      <h1>The platform that scales with you</h1>
      <p>In today's fast-paced world, teams need better tooling. This isn't just a product, it's a complete workflow that empowers everyone.</p>
      <p>Say goodbye to slow builds. Our cutting-edge platform seamlessly integrates with your stack, so you can utilize world-class infrastructure effortlessly every day.</p>
      <p>Whether you are a solo developer or a large enterprise, our robust dashboard quietly syncs your data across every device.</p>
      <p>Built for speed. Designed for teams. Our meticulously crafted components elevate your workflow and unlock your team's potential from day one, every single day.</p>
    </main></body></html>`
    const plain = `<html><body><main>
      <h1>Voxfold documentation</h1>
      <p>Voxfold reads your source files and reports patterns that often appear in generated marketing copy. It runs offline and never calls a model.</p>
      <p>Install it with npm, then point it at a folder or a URL. The command prints each finding with a line number and a score from 0 to 100.</p>
      <p>If a finding is wrong, add a disable comment above the line, or record it in the suppressions file so the team sees the same results.</p>
      <p>The rules live in YAML files. Each one carries a weight, a message and a set of examples that run as tests, so changing a rule cannot quietly change what it matches.</p>
    </main></body></html>`

    const marketingScore = lint(extract(marketing), recommended).score!
    const plainScore = lint(extract(plain), recommended).score!
    expect(marketingScore.value).toBeLessThan(45)
    expect(plainScore.value).toBeGreaterThan(85)
  })
})

describe('html adapter: --fix end to end', () => {
  it('applies a mechanical fix at the correct position with leading markup before the flag', () => {
    const html =
      '<body><header><p>Unrelated header copy with several words in it.</p></header>' +
      '<main><p>We utilize modern tooling in this sentence.</p></main></body>'
    const document = extract(html)
    const result = lint(document, recommended)
    const fixed = applyFixes(html, result.flags)
    expect(fixed).toBe(html.replace('utilize', 'use'))
  })

  it('applies a mechanical fix correctly when the match spans an inline tag', () => {
    const html =
      '<body><p>Some intro copy with several words in it.</p><p>We <b>utilize</b> modern tooling for everything.</p></body>'
    const document = extract(html)
    const result = lint(document, recommended)
    const fixed = applyFixes(html, result.flags)
    expect(fixed).toBe(html.replace('<b>utilize</b>', '<b>use</b>'))
  })
})
