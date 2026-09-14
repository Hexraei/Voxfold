/**
 * Markdown and MDX adapter.
 *
 * Walks mdast rather than running regexes over raw markdown, so `**not just**` inside a sentence
 * is one flat string to the engine and every flag still maps back to exact byte offsets.
 *
 * What counts as prose, and what does not, is the whole job here. Code blocks, front matter, link
 * URLs, image alt text and badge rows are skipped outright; inline code and MDX expressions become
 * placeholders so a sentence keeps its shape without them being linted or edited.
 */

import {
  type Block,
  BlockBuilder,
  type BlockKind,
  type Directive,
  type ExtractContext,
  type LanguageAdapter,
  type NodeRef,
  type ProseDocument,
  parseDirectiveComment,
} from '@voxfold/core'
import type { Nodes, Parents, PhrasingContent, RootContent } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mdxFromMarkdown } from 'mdast-util-mdx'
import { frontmatter } from 'micromark-extension-frontmatter'
import { gfm } from 'micromark-extension-gfm'
import { mdxjs } from 'micromark-extension-mdxjs'
import { markdownWriter } from './writer/index.ts'

export interface MarkdownSettings {
  /** Treat the source as MDX (JSX blocks, expressions, ESM imports). */
  mdx?: boolean
}

/** Block-level mdast nodes that hold prose, mapped to the engine's block kinds. */
const BLOCK_KINDS: Partial<Record<Nodes['type'], BlockKind>> = {
  paragraph: 'paragraph',
  heading: 'heading',
  tableCell: 'tableCell',
}

/** Inline nodes whose children are flattened into the surrounding sentence. */
const INLINE_CONTAINERS = new Set([
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
  'footnoteReference',
])

/** Nodes that stand in for non-prose content: kept as a placeholder, never linted or edited. */
const PLACEHOLDER_NODES = new Set([
  'inlineCode',
  'inlineMath',
  'html',
  'mdxTextExpression',
  'mdxJsxTextElement',
  'break',
  'image',
  'imageReference',
  'footnoteDefinition',
])

/** Node types skipped entirely: code, front matter, math, MDX imports and link definitions. */
const SKIP_NODE_TYPES = new Set<string>([
  'code',
  'yaml',
  'toml',
  'math',
  'mdxjsEsm',
  'mdxFlowExpression',
  'definition',
])

function isParent(node: Nodes): node is Parents {
  return 'children' in node && Array.isArray((node as Parents).children)
}

/** Structural path of a node, used as a stable NodeRef for the writer. */
function pathOf(ancestors: readonly Parents[], node: Nodes): string {
  const parts: string[] = []
  for (let i = 0; i < ancestors.length; i++) {
    const parent = ancestors[i]!
    const child = (ancestors[i + 1] ?? node) as RootContent
    const index = (parent.children as RootContent[]).indexOf(child)
    parts.push(String(index))
  }
  return parts.join('.')
}

/**
 * A paragraph that is only images or linked images: the badge row at the top of a README.
 * Linting it produces noise about alt text that no reader ever sees as prose.
 */
function isBadgeRow(node: Parents): boolean {
  const meaningful = node.children.filter(
    (child) => !(child.type === 'text' && child.value.trim().length === 0),
  )
  if (meaningful.length === 0) return false
  return meaningful.every(
    (child) =>
      child.type === 'image' ||
      child.type === 'imageReference' ||
      ((child.type === 'link' || child.type === 'linkReference') &&
        child.children.every((inner) => inner.type === 'image' || inner.type === 'imageReference')),
  )
}

/** Flatten one block's inline children into a single string with an offset map. */
function buildBlock(
  node: Parents,
  ancestors: readonly Parents[],
  id: string,
  kind: BlockKind,
  source: string,
): Block | undefined {
  const builder = new BlockBuilder()

  const walk = (parent: Parents, parentAncestors: readonly Parents[]): void => {
    for (const child of parent.children as PhrasingContent[]) {
      const position = child.position
      if (!position?.start.offset === undefined || !position) continue
      const start = position.start.offset
      const end = position.end.offset
      if (start === undefined || end === undefined) continue

      const ref: NodeRef = {
        path: pathOf([...parentAncestors, parent], child as Nodes),
        type: child.type,
      }

      if (child.type === 'text') {
        // The raw slice may contain escapes (`\*`) that the parsed value does not, so the
        // mapping is non-linear and needs a charMap built from the raw text.
        const raw = source.slice(start, end)
        if (raw === child.value) {
          builder.addText(child.value, start, end, { node: ref })
        } else {
          const charMap = mapEscapes(raw, child.value, start)
          builder.addText(child.value, start, end, { charMap, node: ref })
        }
        continue
      }

      if (PLACEHOLDER_NODES.has(child.type)) {
        builder.addPlaceholder(start, end, {
          node: ref,
          lockReason:
            child.type === 'mdxTextExpression'
              ? 'expression'
              : child.type === 'html'
                ? 'html-injection'
                : 'inline-tag',
        })
        continue
      }

      if (INLINE_CONTAINERS.has(child.type) && isParent(child as Nodes)) {
        // Link text is prose and is linted; the URL never is.
        walk(child as Parents, [...parentAncestors, parent])
        continue
      }

      if (isParent(child as Nodes)) walk(child as Parents, [...parentAncestors, parent])
    }
  }

  walk(node, ancestors)
  const { block } = builder.build({
    id,
    kind,
    context: {
      weight: 1,
      ...(kind === 'heading' && 'depth' in node
        ? { headingDepth: (node as { depth: number }).depth }
        : {}),
      ...(ancestors.some((a) => a.type === 'list') ? { inList: true } : {}),
    },
  })
  return block.text.trim().length > 0 ? block : undefined
}

/**
 * Map each character of a parsed text value back to its source offset.
 *
 * Markdown escapes mean the raw slice is longer than the value: `\*` is two source characters
 * for one real one. Walking both in step keeps every later offset correct.
 */
function mapEscapes(raw: string, value: string, start: number): Int32Array {
  const charMap = new Int32Array(value.length)
  let rawIndex = 0
  for (let i = 0; i < value.length; i++) {
    // Skip a backslash that escapes the character we are about to consume.
    if (raw[rawIndex] === '\\' && raw[rawIndex + 1] === value[i]) rawIndex++
    charMap[i] = start + rawIndex
    rawIndex++
  }
  return charMap
}

/** Collect `voxfold-*` directives from HTML comments and MDX comment expressions. */
function collectDirectives(tree: Nodes, source: string): Directive[] {
  const directives: Directive[] = []
  const lineOf = (offset: number): number => {
    let line = 1
    for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
    return line
  }

  const visit = (node: Nodes): void => {
    if (
      node.type === 'html' ||
      node.type === 'mdxFlowExpression' ||
      node.type === 'mdxTextExpression'
    ) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        const body = source.slice(start, end)
        const directive = parseDirectiveComment(body, { start, end }, lineOf(start))
        if (directive) directives.push(directive)
      }
    }
    if (isParent(node)) for (const child of node.children) visit(child as Nodes)
  }

  visit(tree)
  return directives
}

/** Parse markdown (or MDX) into an mdast tree with positions. */
export function parseMarkdown(text: string, settings: MarkdownSettings = {}): Nodes {
  return fromMarkdown(text, {
    extensions: [gfm(), frontmatter(['yaml', 'toml']), ...(settings.mdx ? [mdxjs()] : [])],
    mdastExtensions: [
      gfmFromMarkdown(),
      frontmatterFromMarkdown(['yaml', 'toml']),
      ...(settings.mdx ? [mdxFromMarkdown()] : []),
    ],
  })
}

function extract(text: string, context: ExtractContext): ProseDocument {
  const settings = (context.settings ?? {}) as MarkdownSettings
  const mdx = settings.mdx ?? /\.mdx$/i.test(context.uri)
  const tree = parseMarkdown(text, { mdx })

  const blocks: Block[] = []
  let counter = 0

  const walk = (node: Nodes, ancestors: Parents[]): void => {
    // Skip outright: nothing inside these is prose a reader judges. Compared as a string set
    // because extension node types (toml, math) are absent from the base mdast union.
    if (SKIP_NODE_TYPES.has(node.type)) return

    const kind = BLOCK_KINDS[node.type]
    if (kind && isParent(node)) {
      if (!(node.type === 'paragraph' && isBadgeRow(node))) {
        const block = buildBlock(node, ancestors, `${context.uri}#${counter++}`, kind, text)
        if (block) blocks.push(block)
      }
      // A prose block's children are flattened into it, so do not descend further.
      return
    }

    // `blockquote` and `listItem` hold paragraphs; their kind is applied to those paragraphs.
    if (isParent(node)) {
      for (const child of node.children as RootContent[]) {
        walkWithContainer(child as Nodes, [...ancestors, node], node)
      }
    }
  }

  /** Apply a container's block kind (list item, quote) to the paragraphs inside it. */
  const walkWithContainer = (node: Nodes, ancestors: Parents[], container: Parents): void => {
    const containerKind: BlockKind | undefined =
      container.type === 'listItem'
        ? 'listItem'
        : container.type === 'blockquote'
          ? 'blockquote'
          : undefined

    if (containerKind && node.type === 'paragraph' && isParent(node)) {
      const block = buildBlock(node, ancestors, `${context.uri}#${counter++}`, containerKind, text)
      if (block) blocks.push(block)
      return
    }
    walk(node, ancestors)
  }

  walk(tree, [])

  return {
    uri: context.uri,
    format: mdx ? 'mdx' : 'markdown',
    source: text,
    blocks,
    directives: collectDirectives(tree, text),
  }
}

export const markdownAdapter: LanguageAdapter = {
  id: 'markdown',
  extensions: ['.md', '.markdown', '.mdx'],
  extract,
  writer: markdownWriter,
}

export default markdownAdapter
