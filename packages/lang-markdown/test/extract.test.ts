import { applyFixes, lint, mapOf, PLACEHOLDER_CHAR, type ProseDocument } from '@voxfold/core'
import { recommended } from '@voxfold/rules-recommended'
import { describe, expect, it } from 'vitest'
import { markdownAdapter } from '../src/index'

const extract = (text: string, uri = 'test.md') =>
  markdownAdapter.extract(text, { uri }) as ProseDocument

const textsOf = (text: string) => extract(text).blocks.map((block) => block.text)

describe('markdown adapter: what counts as prose', () => {
  it('extracts paragraphs, headings, list items, quotes and table cells', () => {
    const document = extract(`# Title

A paragraph.

- A list item

> A quotation.

| Head |
| ---- |
| Cell |
`)
    expect(document.blocks.map((block) => `${block.kind}:${block.text}`)).toEqual([
      'heading:Title',
      'paragraph:A paragraph.',
      'listItem:A list item',
      'blockquote:A quotation.',
      'tableCell:Head',
      'tableCell:Cell',
    ])
  })

  it('skips code blocks, front matter, link URLs, image alt text and badge rows', () => {
    const texts = textsOf(`---
title: Front matter is not prose
---

[![build](https://img.shields.io/badge.svg)](https://example.com/ci)

\`\`\`js
// A code comment utilizes words but is not prose.
const x = 1
\`\`\`

![An image alt describing a seamless dashboard](/shot.png)

Read [the documentation](https://example.com/docs) first.
`)
    expect(texts).toEqual(['Read the documentation first.'])
  })

  it('flattens inline formatting so a tell spanning tags is still one sentence', () => {
    // The case the whole offset-map design exists for.
    const document = extract("Our platform **doesn't just** manage tasks, it's a workflow.")
    expect(document.blocks[0]!.text).toBe(
      "Our platform doesn't just manage tasks, it's a workflow.",
    )

    const result = lint(document, recommended)
    expect(result.flags.map((flag) => flag.ruleId)).toContain('not-just-x-its-y')
  })

  it('replaces inline code with a placeholder that keeps the sentence shape', () => {
    const document = extract('Run `npm install` to begin.')
    expect(document.blocks[0]!.text).toBe(`Run ${PLACEHOLDER_CHAR} to begin.`)
    // The placeholder must never be offered for editing.
    const map = mapOf(document.blocks[0]!)
    const index = document.blocks[0]!.text.indexOf(PLACEHOLDER_CHAR)
    expect(map.isEditable(index, index + 1)).toBe(false)
  })

  it('marks list items and heading depth in block context', () => {
    const document = extract('## Sub\n\n- One item\n')
    expect(document.blocks[0]!.context.headingDepth).toBe(2)
    expect(document.blocks[1]!.context.inList).toBe(true)
  })
})

describe('markdown adapter: offsets', () => {
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
    check('A plain paragraph with **bold** and _emphasis_ inside it.')
    check('# Heading with `code` and [a link](https://example.com) in it.')
    check('- Item with **bold** text\n- Second item\n')
  })

  it('handles escapes, entities and multibyte characters', () => {
    check('A literal \\* asterisk and a \\_underscore\\_ here.')
    check('Curly quotes: “it doesn’t” — and an em dash.')
    check('Emoji 🚀 and astral 𐀀 characters with **bold** after.')
    check('Tabs\tand   collapsed    spaces.')
  })

  it('reports source ranges that slice back to the flagged text', () => {
    const source = 'We utilize a **robust** platform that empowers teams.'
    const document = extract(source)
    const result = lint(document, recommended)
    expect(result.flags.length).toBeGreaterThan(0)
    for (const flag of result.flags) {
      const rebuilt = flag.sourceRanges.map((r) => source.slice(r.start, r.end)).join('')
      expect(rebuilt).toBe(flag.text)
    }
  })

  it('keeps CRLF files aligned', () => {
    check('First paragraph.\r\n\r\nSecond **bold** paragraph.\r\n')
  })
})

describe('markdown adapter: directives', () => {
  it('reads voxfold-disable comments and silences the next line', () => {
    const source = '<!-- voxfold-disable-next-line utilize -->\nWe utilize it here.\n'
    const document = extract(source)
    expect(document.directives).toHaveLength(1)
    expect(document.directives[0]!.type).toBe('disable-next-line')
    expect(lint(document, recommended).flags.filter((f) => f.ruleId === 'utilize')).toHaveLength(0)
  })

  it('leaves other rules alone when a comment names one rule', () => {
    const source = '<!-- voxfold-disable-next-line utilize -->\nWe utilize a robust platform.\n'
    const flags = lint(extract(source), recommended).flags.map((f) => f.ruleId)
    expect(flags).toContain('robust')
    expect(flags).not.toContain('utilize')
  })
})

describe('markdown adapter: MDX', () => {
  it('skips imports and treats expressions as placeholders', () => {
    const document = markdownAdapter.extract(
      `import { Hero } from './Hero'

We utilize {count} items.
`,
      { uri: 'page.mdx' },
    ) as import('@voxfold/core').ProseDocument

    expect(document.format).toBe('mdx')
    expect(document.blocks.map((b) => b.text)).toEqual([`We utilize ${PLACEHOLDER_CHAR} items.`])
  })
})

describe('markdown adapter: real README shape', () => {
  it('scores a generated-style README far below a plain one', () => {
    const generated = `# 🚀 Awesome Tool

In today's fast-paced world, developers need better tooling. This isn't just a linter, it's a complete workflow that empowers your team.

## ✨ Features

- **Fast:** blazing performance
- **Simple:** zero configuration needed
- **Robust:** built for scale

Say goodbye to slow builds. Our cutting-edge platform seamlessly integrates with your stack, so you can utilize world-class infrastructure effortlessly.

## Getting Started

Whether you are a solo developer or a large enterprise team, getting started is simple. The dashboard quietly syncs your settings across every device you own, and our robust pipeline handles the rest for you.
`
    const plain = `# Voxfold

Voxfold reads your source files and reports patterns that often appear in generated marketing copy. It runs offline and never calls a model.

## Install

Run \`npm install voxfold\`, then point it at a folder or a URL. It prints each finding with a line number and a score from 0 to 100.

## Configuration

Rules live in a YAML file. Turn one off with a disable comment above the line, or record it in the suppressions file so the whole team sees the same results.
`
    const generatedScore = lint(extract(generated), recommended).score
    const plainScore = lint(extract(plain), recommended).score

    expect(generatedScore!.value).toBeLessThan(40)
    expect(plainScore!.value).toBeGreaterThan(85)
  })
})

describe('markdown adapter: --fix end to end', () => {
  it('applies a mechanical fix at the correct source position when the flag is not at the start of the file', () => {
    // This is the scenario a real corruption bug shipped in: leading content pushes the block's
    // source offset away from 0, and the fix must still land in exactly the right place rather
    // than at the flat-text offset within the block.
    const text =
      '# Title\n\nSome unrelated leading paragraph with plenty of its own words.\n\nWe utilize modern tooling in this sentence.\n'
    const document = extract(text)
    const result = lint(document, recommended)
    const fixed = applyFixes(text, result.flags)
    expect(fixed).toBe(text.replace('utilize', 'use'))
  })

  it('applies a mechanical fix correctly when the match spans inline formatting', () => {
    const text =
      'Some intro paragraph here with several words in it.\n\nWe **utilize** modern tooling for everything we build.'
    const document = extract(text)
    const result = lint(document, recommended)
    const fixed = applyFixes(text, result.flags)
    expect(fixed).toBe(text.replace('**utilize**', '**use**'))
  })

  it('applies fixes independently and correctly across several blocks', () => {
    const text = [
      'First paragraph, we utilize caching here for speed.',
      '',
      'Second paragraph, we utilize batching here for throughput.',
      '',
      'Third paragraph has no tells at all in it, just plain words.',
    ].join('\n')
    const document = extract(text)
    const result = lint(document, recommended)
    const fixed = applyFixes(text, result.flags)
    expect(fixed).toBe(text.replaceAll('utilize', 'use'))
  })
})
