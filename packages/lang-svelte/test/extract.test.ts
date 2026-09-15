import { lint, mapOf, PLACEHOLDER_CHAR, type ProseDocument } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import { describe, expect, it } from 'vitest'
import { svelteAdapter } from '../src/index.ts'

const extract = (code: string, uri = 'Component.svelte') =>
  svelteAdapter.extract(code, { uri }) as ProseDocument

const texts = (code: string) => extract(code).blocks.map((block) => block.text)

describe('svelte adapter: what counts as prose', () => {
  it('extracts headings, paragraphs, list items and table cells from markup', () => {
    const code = `
      <div>
        <h1>A heading long enough to count</h1>
        <p>A paragraph of real page copy.</p>
        <ul><li>A list item with several words</li></ul>
        <table><tbody><tr><td>A table cell with words</td></tr></tbody></table>
      </div>
    `
    expect(extract(code).blocks.map((b) => `${b.kind}:${b.text}`)).toEqual([
      'heading:A heading long enough to count',
      'paragraph:A paragraph of real page copy.',
      'listItem:A list item with several words',
      'tableCell:A table cell with words',
    ])
  })

  it('flattens inline elements so a tell spanning tags is still one sentence', () => {
    const code = `<p>Our platform <strong>doesn't just</strong> manage tasks, it's a workflow.</p>`
    const document = extract(code)
    expect(document.blocks[0]!.text).toBe(
      "Our platform doesn't just manage tasks, it's a workflow.",
    )
    const result = lint(document, recommended)
    expect(result.flags.map((f) => f.ruleId)).toContain('not-just-x-its-y')
  })

  it('skips code/pre and script/style blocks, never treating them as prose', () => {
    const code = `<script>\n  let x = 1\n</script>\n<div>\n  <pre>we utilize a robust code sample here</pre>\n  <p>The only visible paragraph on the page.</p>\n</div>\n<style>\n  p { color: red; }\n</style>`
    expect(texts(code)).toEqual(['The only visible paragraph on the page.'])
  })

  it('turns {expr} into a placeholder that keeps the sentence shape', () => {
    const document = extract(`<p>Run {command} to begin the process now.</p>`)
    expect(document.blocks[0]!.text).toBe(`Run ${PLACEHOLDER_CHAR} to begin the process now.`)
    const map = mapOf(document.blocks[0]!)
    const index = document.blocks[0]!.text.indexOf(PLACEHOLDER_CHAR)
    expect(map.isEditable(index, index + 1)).toBe(false)
  })

  it('locks {@html ...} content instead of treating it as editable prose', () => {
    const document = extract(`<p>{@html rawContent}</p>`)
    expect(document.blocks[0]!.text).toBe(PLACEHOLDER_CHAR)
    const segment = document.blocks[0]!.segments.find((s) => s.kind === 'placeholder')!
    expect(segment.lockReason).toBe('html-injection')
  })

  it('locks text inside a {#each} body as map, consistent with JSX .map() text', () => {
    const document = extract(
      `<ul>{#each items as item}<li>{item.name} is robust and reliable</li>{/each}</ul>`,
    )
    // The <li> inside {#each} is itself a block-level element visited directly by collectBlocks,
    // so its own text is locked even though it's not wrapped in an outer {#each}-only block.
    const block = document.blocks.find((b) => b.kind === 'listItem')!
    const seg = block.segments.find((s) => s.kind === 'placeholder')
    expect(seg?.lockReason).toBe('map')
  })

  it('does not lock text inside a static {#if} branch', () => {
    const document = extract(`<p>{#if ready}You have items available now.{/if}</p>`)
    expect(document.blocks[0]!.text).toBe('You have items available now.')
  })
})

describe('svelte adapter: lock reasons on {expr}', () => {
  const lockReasonOf = (code: string) => {
    const document = extract(code)
    const segment = document.blocks[0]!.segments.find((s) => s.kind === 'placeholder')!
    return segment.lockReason
  }

  it('a .map() call locks as map', () => {
    expect(lockReasonOf(`<p>Say {items.map((i) => i)} today please.</p>`)).toBe('map')
  })

  it('a bare identifier locks as variable', () => {
    expect(lockReasonOf(`<p>Say {greeting} to everyone here today.</p>`)).toBe('variable')
  })

  it('a member expression locks as variable', () => {
    expect(lockReasonOf(`<p>Say {user.name} to everyone here today.</p>`)).toBe('variable')
  })

  it('a template literal locks as template-literal', () => {
    const dollar = String.fromCharCode(36)
    const source = `<p>Say {\`hi ${dollar}{name}\`} to everyone today please.</p>`
    expect(lockReasonOf(source)).toBe('template-literal')
  })

  it('a t(...) i18n call locks as i18n', () => {
    expect(lockReasonOf(`<p>Say {t('greeting')} to everyone here today.</p>`)).toBe('i18n')
  })

  it('a $t(...) i18n call locks as i18n', () => {
    expect(lockReasonOf(`<p>Say {$t('greeting')} to everyone here today.</p>`)).toBe('i18n')
  })
})

describe('svelte adapter: offsets', () => {
  const check = (source: string) => {
    const document = extract(source)
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

  it('maps every character back to the identical source character', () => {
    check(`<p>A plain paragraph with <strong>bold</strong> and <em>emphasis</em>.</p>`)
    check(`<h1>Heading with <a href="/x">a link</a> in it.</h1>`)
    check(`<p>Curly quotes: "it doesn't" here now, no entities.</p>`)
  })

  it('handles multibyte characters', () => {
    check(`<p>Emoji 🚀 and astral 𐀀 characters after that.</p>`)
  })

  it('handles curly/straight quotes, dash variants and NBSP', () => {
    check(`<p>Curly ‘quotes’ and “double” marks — em dash here.</p>`)
    check(`<p>An en–dash and a non breaking space right here.</p>`)
  })

  it('handles CRLF line endings inside a block', () => {
    check(`<p>\r\n  A paragraph split across two lines here.\r\n</p>\r\n`)
  })

  it('decodes HTML entities in template text and keeps later offsets aligned', () => {
    const source = `<p>Tom &amp; Jerry utilize a robust platform daily.</p>`
    const document = extract(source)
    expect(document.blocks[0]!.text).toBe('Tom & Jerry utilize a robust platform daily.')
    const flag = lint(document, recommended).flags.find((f) => f.ruleId === 'utilize')!
    expect(source.slice(flag.sourceRanges[0]!.start, flag.sourceRanges[0]!.end)).toBe('utilize')
  })

  it('reports source ranges that slice back to the flagged text', () => {
    const source = `<p>We utilize a <strong>robust</strong> platform that empowers teams.</p>`
    const document = extract(source)
    const result = lint(document, recommended)
    expect(result.flags.length).toBeGreaterThan(0)
    for (const flag of result.flags) {
      const rebuilt = flag.sourceRanges.map((r) => source.slice(r.start, r.end)).join('')
      expect(rebuilt).toBe(flag.text)
    }
  })

  it('handles nested inline elements and multiline text', () => {
    const code = `<p>\n  Our platform utilizes a <strong>very <em>robust</em></strong> approach every day.\n</p>`
    const document = extract(code)
    expect(document.blocks[0]!.text).toContain('very robust approach')
  })

  it('does not collapse whitespace inside a text node (unlike Vue)', () => {
    // Spike result: svelte/compiler does not condense runs of whitespace the way
    // @vue/compiler-sfc does, so a raw newline+indent run stays literal in `.data`.
    const source = `<p>Line one\n    line two continues right here today.</p>`
    const document = extract(source)
    expect(document.blocks[0]!.text).toBe('Line one\n    line two continues right here today.')
  })
})

describe('svelte adapter: directives', () => {
  it('reads a voxfold-disable-next-line HTML comment and silences the next block', () => {
    const code = `
      <div>
        <!-- voxfold-disable-next-line utilize -->
        <p>We utilize it here today in this sentence.</p>
      </div>
    `
    const document = extract(code)
    expect(document.directives).toHaveLength(1)
    expect(document.directives[0]!.type).toBe('disable-next-line')
    expect(lint(document, recommended).flags.filter((f) => f.ruleId === 'utilize')).toHaveLength(0)
  })

  it('leaves other rules alone when a comment names one rule', () => {
    const code = `
      <div>
        <!-- voxfold-disable-next-line utilize -->
        <p>We utilize a robust platform here today for everyone.</p>
      </div>
    `
    const flags = lint(extract(code), recommended).flags.map((f) => f.ruleId)
    expect(flags).toContain('robust')
    expect(flags).not.toContain('utilize')
  })
})

describe('svelte adapter: Svelte-4-flavored syntax', () => {
  // export let / on:click / no runes — parsed with the same modern:true option as Svelte 5
  // (runes) source. See the module doc comment in src/index.ts for the spike result: a single
  // svelte@5.x compiler normalizes both syntax generations to the same AST shape.
  const legacy = `<script>
  export let items = []
  function go() {}
</script>

<button on:click={go}>Click here to continue</button>
<p>We utilize a robust platform every day for our whole team.</p>
<ul>
{#each items as item}
  <li>{item.name} is robust</li>
{/each}
</ul>
`

  it('extracts prose the same way regardless of legacy export-let/on: syntax', () => {
    const document = extract(legacy)
    const paragraph = document.blocks.find((b) => b.kind === 'paragraph')!
    expect(paragraph.text).toBe('We utilize a robust platform every day for our whole team.')
    const flags = lint(document, recommended).flags.map((f) => f.ruleId)
    expect(flags).toContain('utilize')
  })

  it('still locks {#each} body text as map under legacy syntax', () => {
    const document = extract(legacy)
    const listItem = document.blocks.find((b) => b.kind === 'listItem')!
    const seg = listItem.segments.find((s) => s.kind === 'placeholder')
    expect(seg?.lockReason).toBe('map')
  })

  it('still extracts the <button> label as a block under legacy on: syntax', () => {
    const document = extract(legacy)
    const label = document.blocks.find((b) => b.kind === 'label')!
    expect(label.text).toBe('Click here to continue')
  })
})

describe('svelte adapter: a realistic component', () => {
  it('scores a generated-style component far below a plain one', () => {
    const generated = `<script>
      export let name
    </script>
    <div>
      <h1>The platform that scales with you</h1>
      <p>In today's fast-paced world, teams need better tooling. This isn't just a product, it's a complete workflow that empowers everyone.</p>
      <p>Say goodbye to slow builds. Our cutting-edge platform seamlessly integrates with your stack, so you can utilize world-class infrastructure effortlessly every day.</p>
      <p>Whether you are a solo developer or a large enterprise, our robust dashboard quietly syncs your data across every device you own.</p>
      <p>Built for speed. Designed for teams. Our meticulously crafted components elevate your workflow and unlock your team's potential from day one, every single day.</p>
    </div>`
    const plain = `<script>
      export let name
    </script>
    <div>
      <h1>Voxfold documentation</h1>
      <p>Voxfold reads your source files and reports patterns that often appear in generated marketing copy. It runs offline and never calls a model.</p>
      <p>Install it with npm, then point it at a folder or a URL. The command prints each finding with a line number and a score from 0 to 100.</p>
      <p>If a finding is wrong, add a disable comment above the line, or record it in the suppressions file so the team sees the same results.</p>
      <p>Rules live in YAML files. Each one carries a weight, a message and a set of examples that run as tests, so changing a rule cannot quietly change what it matches.</p>
    </div>`
    const generatedScore = lint(extract(generated), recommended).score!
    const plainScore = lint(extract(plain), recommended).score!
    expect(generatedScore.value).toBeLessThan(45)
    expect(plainScore.value).toBeGreaterThan(85)
  })
})
