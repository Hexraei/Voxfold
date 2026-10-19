/**
 * SARIF 2.1.0, so results can upload to GitHub code scanning
 * (`github/codeql-action/upload-sarif`) and show up as annotations without a bespoke Action.
 */

import type { ProjectSummary } from '../lint-runner.ts'
import { displayPath } from './display-path.ts'

function lineOf(source: string | undefined, offset: number): number {
  if (!source) return 1
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

function columnOf(source: string | undefined, offset: number): number {
  if (!source) return 1
  const lastNewline = source.lastIndexOf('\n', offset - 1)
  return offset - lastNewline
}

export function formatSarif(summary: ProjectSummary, cwd: string): string {
  const ruleIds = new Set<string>()
  for (const { result } of summary.files) for (const flag of result.flags) ruleIds.add(flag.ruleId)

  const rules = [...ruleIds].sort().map((id) => {
    const flag = summary.files.flatMap((f) => f.result.flags).find((f) => f.ruleId === id)!
    return {
      id,
      shortDescription: { text: flag.message },
      fullDescription: { text: flag.docs },
      properties: { category: flag.category },
    }
  })

  const results = summary.files.flatMap(({ file, document, result }) =>
    result.flags.map((flag) => {
      const range = flag.sourceRanges[0]
      return {
        ruleId: flag.ruleId,
        level: flag.severity === 'error' ? 'error' : 'warning',
        message: { text: flag.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: displayPath(file, cwd).split('\\').join('/') },
              region: {
                startLine: lineOf(document.source, range?.start ?? 0),
                startColumn: columnOf(document.source, range?.start ?? 0),
                endLine: lineOf(document.source, range?.end ?? 0),
                endColumn: columnOf(document.source, range?.end ?? 0),
              },
            },
          },
        ],
      }
    }),
  )

  const sarif = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'voxfold',
            informationUri: 'https://github.com/Hexraei/Voxfold',
            rules,
          },
        },
        results,
      },
    ],
  }
  return `${JSON.stringify(sarif, null, 2)}\n`
}
