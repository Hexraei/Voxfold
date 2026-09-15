import { lint, mapOf, PLACEHOLDER_CHAR, type ProseDocument } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import { describe, expect, it } from 'vitest'
import { astroAdapter } from '../src/index.ts'

const FRONTMATTER = '---\nconst title = "hi"\n---\n'

const extract = async (template: string, uri = 'Component.astro') =>
  (await astroAdapter.extract(`${FRONTMATTER}${template}`, { uri })) as ProseDocument

const texts = async (template: string) =>
  (await extract(template)).blocks.map((block) => block.text)

describe('astro adapter: what counts as prose', () => {
  it('extracts headings, paragraphs, list items and table cells from markup', async () => {
    const template = `
      <div>
        <h1>A heading long enough to count</h1>
        <p>A paragraph of real page copy.</p>
        <ul><li>A list item with several words</li></ul>
        <table><tbody><tr><td>A table cell with words</td></tr></tbody></table>
      </div>
    `
    const document = await extract(template)
    expect(document.blocks.map((b) => `${b.kind}:${b.text}`)).toEqual([
      'heading:A heading long enough to count',
      'paragraph:A paragraph of real page copy.',
      'listItem:A list item with several words',
      'tableCell:A table cell with words',
    ])
  })

  it('never treats frontmatter content as prose', async () => {
    const document = (await astroAdapter.extract(
      `---\nconst title = "We utilize a robust platform every day for everyone."\n---\n<p>Only this paragraph counts as prose text here.</p>`,
      { uri: 'x.astro' },
    )) as ProseDocument
    expect(document.blocks).toHaveLength(1)
    expect(document.blocks[0]!.text).toBe('Only this paragraph counts as prose text here.')
  })

  it('flattens inline elements so a tell spanning tags is still one sentence', async () => {
    const document = await extract(
      `<p>Our platform <strong>doesn't just</strong> manage tasks, it's a workflow.</p>`,
    )
    expect(document.blocks[0]!.text).toBe(
      "Our platform doesn't just manage tasks, it's a workflow.",
    )
    const result = lint(document, recommended)
    expect(result.flags.map((f) => f.ruleId)).toContain('not-just-x-its-y')
  })

  it('skips code/pre and script/style blocks, never treating them as prose', async () => {
    const template = `<div>\n  <pre>we utilize a robust code sample here</pre>\n  <p>The only visible paragraph on the page.</p>\n  <script>console.log('we utilize inline scripts')</script>\n</div>\n<style>\n  p { color: red; }\n</style>`
    expect(await texts(template)).toEqual(['The only visible paragraph on the page.'])
  })

  it('turns {expr} into a placeholder that keeps the sentence shape', async () => {
    const document = await extract(`<p>Run {command} to begin the process now.</p>`)
    expect(document.blocks[0]!.text).toBe(`Run ${PLACEHOLDER_CHAR} to begin the process now.`)
    const map = mapOf(document.blocks[0]!)
    const index = document.blocks[0]!.text.indexOf(PLACEHOLDER_CHAR)
    expect(map.isEditable(index, index + 1)).toBe(false)
  })

  it('locks set:html content instead of treating it as editable prose', async () => {
    const document = await extract(`<p set:html={rawContent}>fallback text ignored</p>`)
    expect(document.blocks).toHaveLength(0)
    // set:html locks the WHOLE element (no block anchored there), verified via stamp() tests too.
  })

  it('locks a set:html element even when it produces no separate block', async () => {
    const document = await extract(
      `<div><p set:html={rawContent}></p><p>Real paragraph here now.</p></div>`,
    )
    expect(document.blocks.map((b) => b.text)).toEqual(['Real paragraph here now.'])
  })

  it('locks text produced by a .map() expression, matching Vue/Svelte/JSX', async () => {
    const document = await extract(
      `<ul>{items.map((item) => <li>{item.name} is robust today</li>)}</ul>`,
    )
    const block = document.blocks.find((b) => b.kind === 'listItem')!
    const seg = block.segments.find((s) => s.kind === 'placeholder')
    expect(seg?.lockReason).toBe('map')
  })

  it("walks a component's slotted children as inline prose", async () => {
    const document = await extract(
      `<p>Intro copy <Badge>slotted label text here</Badge> continues after.</p>`,
    )
    expect(document.blocks[0]!.text).toBe('Intro copy slotted label text here continues after.')
  })
})

describe('astro adapter: lock reasons on {expr}', () => {
  const lockReasonOf = async (template: string) => {
    const document = await extract(template)
    const segment = document.blocks[0]!.segments.find((s) => s.kind === 'placeholder')!
    return segment.lockReason
  }

  it('a bare identifier locks as variable', async () => {
    expect(await lockReasonOf(`<p>Say {greeting} to everyone here today.</p>`)).toBe('variable')
  })

  it('a member expression locks as variable', async () => {
    expect(await lockReasonOf(`<p>Say {user.name} to everyone here today.</p>`)).toBe('variable')
  })

  it('a .map() call locks as map', async () => {
    expect(await lockReasonOf(`<p>Say {items.map((i) => i)} today please.</p>`)).toBe('map')
  })

  it('a t(...) i18n call locks as i18n', async () => {
    expect(await lockReasonOf(`<p>Say {t('greeting')} to everyone here today.</p>`)).toBe('i18n')
  })
})

describe('astro adapter: offsets', () => {
  const check = async (template: string) => {
    const source = `${FRONTMATTER}${template}`
    const document = (await astroAdapter.extract(source, { uri: 'x.astro' })) as ProseDocument
    for (const block of document.blocks) {
      const map = mapOf(block)
      for (let i = 0; i < block.text.length; i++) {
        const segment = map.segmentAt(i)
        if (segment?.kind !== 'text') continue
        const offset = map.toSource(i, 'start')
        expect(offset, `no source for index ${i} of ${JSON.stringify(block.text)}`).toBeDefined()
        expect(source[offset!]).toBe(block.text[i])
      }
    }
  }

  it('maps every character back to the identical source character', async () => {
    await check(`<p>A plain paragraph with <strong>bold</strong> and <em>emphasis</em>.</p>`)
    await check(`<h1>Heading with <a href="/x">a link</a> in it.</h1>`)
  })

  it('handles multibyte characters (emoji, curly quotes) ahead of plain text — the spike case', async () => {
    await check(`<p>Emoji 😀 and curly "quotes" precede this plain ASCII text right here.</p>`)
  })

  it('handles astral-plane characters (surrogate pairs)', async () => {
    await check(`<p>Astral 𐀀 characters after that, still plain text here.</p>`)
  })

  it('reports source ranges that slice back to the flagged text', async () => {
    const source = `${FRONTMATTER}<p>We utilize a <strong>robust</strong> platform that empowers teams.</p>`
    const document = (await astroAdapter.extract(source, { uri: 'x.astro' })) as ProseDocument
    const result = lint(document, recommended)
    expect(result.flags.length).toBeGreaterThan(0)
    for (const flag of result.flags) {
      const rebuilt = flag.sourceRanges.map((r) => source.slice(r.start, r.end)).join('')
      expect(rebuilt).toBe(flag.text)
    }
  })

  it('decodes HTML entities in template text (adapter-level, unlike Svelte/Vue whose compilers do it)', async () => {
    // @astrojs/compiler itself does NOT decode entities in a text node's .value (spike result,
    // see index.ts's module doc) — this adapter decodes them itself so a reader-visible `&amp;`
    // reads as `&`, matching every other HTML-flavored adapter's extract() output.
    const document = await extract(`<p>Tom &amp; Jerry utilize a robust platform daily.</p>`)
    expect(document.blocks[0]!.text).toBe('Tom & Jerry utilize a robust platform daily.')
    const flag = lint(document, recommended).flags.find((f) => f.ruleId === 'utilize')!
    const source = `${FRONTMATTER}<p>Tom &amp; Jerry utilize a robust platform daily.</p>`
    expect(source.slice(flag.sourceRanges[0]!.start, flag.sourceRanges[0]!.end)).toBe('utilize')
  })
})

describe('astro adapter: directives', () => {
  it('reads a voxfold-disable-next-line HTML comment and silences the next block', async () => {
    const template = `
      <div>
        <!-- voxfold-disable-next-line utilize -->
        <p>We utilize it here today in this sentence.</p>
      </div>
    `
    const document = await extract(template)
    expect(document.directives).toHaveLength(1)
    expect(document.directives[0]!.type).toBe('disable-next-line')
    expect(lint(document, recommended).flags.filter((f) => f.ruleId === 'utilize')).toHaveLength(0)
  })
})

describe('astro adapter: a realistic component', () => {
  it('scores a generated-style component far below a plain one', async () => {
    const generated = `
    <div>
      <h1>The platform that scales with you</h1>
      <p>In today's fast-paced world, teams need better tooling. This isn't just a product, it's a complete workflow that empowers everyone.</p>
      <p>Say goodbye to slow builds. Our cutting-edge platform seamlessly integrates with your stack, so you can utilize world-class infrastructure effortlessly every day.</p>
      <p>Whether you are a solo developer or a large enterprise, our robust dashboard quietly syncs your data across every device you own.</p>
      <p>Built for speed. Designed for teams. Our meticulously crafted components elevate your workflow and unlock your team's potential from day one, every single day.</p>
    </div>`
    const plain = `
    <div>
      <h1>Voxfold documentation</h1>
      <p>Voxfold reads your source files and reports patterns that often appear in generated marketing copy. It runs offline and never calls a model.</p>
      <p>Install it with npm, then point it at a folder or a URL. The command prints each finding with a line number and a score from 0 to 100.</p>
      <p>If a finding is wrong, add a disable comment above the line, or record it in the suppressions file so the team sees the same results.</p>
      <p>Rules live in YAML files. Each one carries a weight, a message and a set of examples that run as tests, so changing a rule cannot quietly change what it matches.</p>
    </div>`
    const generatedScore = lint(await extract(generated), recommended).score!
    const plainScore = lint(await extract(plain), recommended).score!
    expect(generatedScore.value).toBeLessThan(45)
    expect(plainScore.value).toBeGreaterThan(85)
  })
})
