import { lint, mapOf, PLACEHOLDER_CHAR, type ProseDocument } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import { describe, expect, it } from 'vitest'
import { vueAdapter } from '../src/index.ts'

const extract = (code: string, uri = 'Component.vue') =>
  vueAdapter.extract(code, { uri }) as ProseDocument

const texts = (code: string) => extract(code).blocks.map((block) => block.text)

const wrap = (template: string) => `<template>\n${template}\n</template>`

describe('vue adapter: what counts as prose', () => {
  it('extracts headings, paragraphs, list items and table cells from template elements', () => {
    const code = wrap(`
      <div>
        <h1>A heading long enough to count</h1>
        <p>A paragraph of real page copy.</p>
        <ul><li>A list item with several words</li></ul>
        <table><tbody><tr><td>A table cell with words</td></tr></tbody></table>
      </div>
    `)
    expect(extract(code).blocks.map((b) => `${b.kind}:${b.text}`)).toEqual([
      'heading:A heading long enough to count',
      'paragraph:A paragraph of real page copy.',
      'listItem:A list item with several words',
      'tableCell:A table cell with words',
    ])
  })

  it('flattens inline elements so a tell spanning tags is still one sentence', () => {
    const code = wrap(
      `<p>Our platform <strong>doesn't just</strong> manage tasks, it's a workflow.</p>`,
    )
    const document = extract(code)
    expect(document.blocks[0]!.text).toBe(
      "Our platform doesn't just manage tasks, it's a workflow.",
    )
    const result = lint(document, recommended)
    expect(result.flags.map((f) => f.ruleId)).toContain('not-just-x-its-y')
  })

  it('skips script/style/code/pre and never treats them as prose', () => {
    const code = `<script setup>\nconst x = 1\n</script>\n${wrap(`
      <div>
        <pre>we utilize a robust code sample here</pre>
        <p>The only visible paragraph on the page.</p>
      </div>
    `)}\n<style>\np { color: red; }\n</style>`
    expect(texts(code)).toEqual(['The only visible paragraph on the page.'])
  })

  it('turns {{ expr }} into a placeholder that keeps the sentence shape', () => {
    const document = extract(wrap(`<p>Run {{ command }} to begin the process now.</p>`))
    expect(document.blocks[0]!.text).toBe(`Run ${PLACEHOLDER_CHAR} to begin the process now.`)
    const map = mapOf(document.blocks[0]!)
    const index = document.blocks[0]!.text.indexOf(PLACEHOLDER_CHAR)
    expect(map.isEditable(index, index + 1)).toBe(false)
  })

  it('locks v-html content instead of treating it as editable prose', () => {
    const document = extract(
      wrap(`<p v-html="rawHtml">fallback text that should never be linted here</p>`),
    )
    expect(document.blocks[0]!.text).toBe(PLACEHOLDER_CHAR)
    const segment = document.blocks[0]!.segments.find((s) => s.kind === 'placeholder')!
    expect(segment.lockReason).toBe('html-injection')
  })

  it('does not produce a block for an empty v-html element', () => {
    expect(texts(wrap(`<p v-html="rawHtml"></p>`))).toEqual([])
  })

  it('locks v-t fallback content as i18n', () => {
    const document = extract(wrap(`<p v-t="'greeting.hello'">fallback greeting text here</p>`))
    expect(document.blocks[0]!.text).toBe(PLACEHOLDER_CHAR)
    const segment = document.blocks[0]!.segments.find((s) => s.kind === 'placeholder')!
    expect(segment.lockReason).toBe('i18n')
  })
})

describe('vue adapter: lock reasons on {{ expr }}', () => {
  const lockReasonOf = (code: string) => {
    const document = extract(code)
    const segment = document.blocks[0]!.segments.find((s) => s.kind === 'placeholder')!
    return segment.lockReason
  }

  it('a .map() call locks as map', () => {
    expect(lockReasonOf(wrap(`<p>Say {{ items.map(i => i) }} today please.</p>`))).toBe('map')
  })

  it('a bare identifier locks as variable', () => {
    expect(lockReasonOf(wrap(`<p>Say {{ greeting }} to everyone here today.</p>`))).toBe('variable')
  })

  it('a template literal locks as template-literal', () => {
    const dollar = String.fromCharCode(36)
    const source = `<p>Say {{ \`hi ${dollar}{name}\` }} to everyone today please.</p>`
    expect(lockReasonOf(wrap(source))).toBe('template-literal')
  })

  it('a t(...) i18n call locks as i18n', () => {
    expect(lockReasonOf(wrap(`<p>Say {{ t('greeting') }} to everyone here today.</p>`))).toBe(
      'i18n',
    )
  })

  it('a $t(...) i18n call locks as i18n', () => {
    expect(lockReasonOf(wrap(`<p>Say {{ $t('greeting') }} to everyone here today.</p>`))).toBe(
      'i18n',
    )
  })
})

describe('vue adapter: offsets', () => {
  const check = (source: string) => {
    const document = extract(source)
    for (const block of document.blocks) {
      const map = mapOf(block)
      for (let i = 0; i < block.text.length; i++) {
        const segment = map.segmentAt(i)
        if (segment?.kind !== 'text') continue
        const offset = map.toSource(i, 'start')
        expect(offset, `no source for index ${i} of ${JSON.stringify(block.text)}`).toBeDefined()
        // A collapsed whitespace run maps to its first source character, which need not itself
        // be a plain space (it could be a tab, newline, or CRLF pair) — same allowance lang-html's
        // equivalent test makes.
        if (block.text[i] === ' ') continue
        expect(source[offset!]).toBe(block.text[i])
      }
    }
  }

  it('maps every character back to the identical source character', () => {
    check(wrap(`<p>A plain paragraph with <strong>bold</strong> and <em>emphasis</em>.</p>`))
    check(wrap(`<h1>Heading with <a href="/x">a link</a> in it.</h1>`))
    check(wrap(`<p>Curly quotes: "it doesn't" here now, no entities.</p>`))
  })

  it('handles multibyte characters', () => {
    check(wrap(`<p>Emoji 🚀 and astral 𐀀 characters after that.</p>`))
  })

  it('handles curly/straight quotes, dash variants and NBSP', () => {
    check(wrap(`<p>Curly ‘quotes’ and “double” marks — em dash here.</p>`))
    check(wrap(`<p>An en–dash and a non breaking space right here.</p>`))
  })

  it('handles CRLF line endings inside a block', () => {
    check(
      `<template>\r\n  <p>\r\n    A paragraph split across two lines here.\r\n  </p>\r\n</template>\r\n`,
    )
  })

  it('decodes HTML entities in template text and keeps later offsets aligned', () => {
    const source = wrap(`<p>Tom &amp; Jerry utilize a robust platform daily.</p>`)
    const document = extract(source)
    expect(document.blocks[0]!.text).toBe('Tom & Jerry utilize a robust platform daily.')
    const flag = lint(document, recommended).flags.find((f) => f.ruleId === 'utilize')!
    expect(source.slice(flag.sourceRanges[0]!.start, flag.sourceRanges[0]!.end)).toBe('utilize')
  })

  it('reports source ranges that slice back to the flagged text', () => {
    const source = wrap(`<p>We utilize a <strong>robust</strong> platform that empowers teams.</p>`)
    const document = extract(source)
    const result = lint(document, recommended)
    expect(result.flags.length).toBeGreaterThan(0)
    for (const flag of result.flags) {
      const rebuilt = flag.sourceRanges.map((r) => source.slice(r.start, r.end)).join('')
      expect(rebuilt).toBe(flag.text)
    }
  })

  it('handles nested inline elements and multiline text', () => {
    const code = `<template>
      <p>
        Our platform utilizes a <strong>very <em>robust</em></strong> approach every day.
      </p>
    </template>`
    const document = extract(code)
    expect(document.blocks[0]!.text).toContain('very robust approach')
  })
})

describe('vue adapter: directives', () => {
  it('reads a voxfold-disable-next-line HTML comment in the template and silences the next block', () => {
    const code = wrap(`
      <div>
        <!-- voxfold-disable-next-line utilize -->
        <p>We utilize it here today in this sentence.</p>
      </div>
    `)
    const document = extract(code)
    expect(document.directives).toHaveLength(1)
    expect(document.directives[0]!.type).toBe('disable-next-line')
    expect(lint(document, recommended).flags.filter((f) => f.ruleId === 'utilize')).toHaveLength(0)
  })

  it('leaves other rules alone when a comment names one rule', () => {
    const code = wrap(`
      <div>
        <!-- voxfold-disable-next-line utilize -->
        <p>We utilize a robust platform here today for everyone.</p>
      </div>
    `)
    const flags = lint(extract(code), recommended).flags.map((f) => f.ruleId)
    expect(flags).toContain('robust')
    expect(flags).not.toContain('utilize')
  })
})

describe('vue adapter: a realistic component', () => {
  it('scores a generated-style component far below a plain one', () => {
    const generated = `<script setup>
      defineProps<{ name: string }>()
    </script>
    <template>
      <div>
        <h1>The platform that scales with you</h1>
        <p>In today's fast-paced world, teams need better tooling. This isn't just a product, it's a complete workflow that empowers everyone.</p>
        <p>Say goodbye to slow builds. Our cutting-edge platform seamlessly integrates with your stack, so you can utilize world-class infrastructure effortlessly every day.</p>
        <p>Whether you are a solo developer or a large enterprise, our robust dashboard quietly syncs your data across every device you own.</p>
        <p>Built for speed. Designed for teams. Our meticulously crafted components elevate your workflow and unlock your team's potential from day one, every single day.</p>
      </div>
    </template>`
    const plain = `<script setup>
      defineProps<{ name: string }>()
    </script>
    <template>
      <div>
        <h1>Voxfold documentation</h1>
        <p>Voxfold reads your source files and reports patterns that often appear in generated marketing copy. It runs offline and never calls a model.</p>
        <p>Install it with npm, then point it at a folder or a URL. The command prints each finding with a line number and a score from 0 to 100.</p>
        <p>If a finding is wrong, add a disable comment above the line, or record it in the suppressions file so the team sees the same results.</p>
        <p>Rules live in YAML files. Each one carries a weight, a message and a set of examples that run as tests, so changing a rule cannot quietly change what it matches.</p>
      </div>
    </template>`
    const generatedScore = lint(extract(generated), recommended).score!
    const plainScore = lint(extract(plain), recommended).score!
    expect(generatedScore.value).toBeLessThan(45)
    expect(plainScore.value).toBeGreaterThan(85)
  })
})
