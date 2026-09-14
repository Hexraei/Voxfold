/**
 * Decode a JS string literal's raw source (quotes and all) into its runtime value, with a source
 * offset for every decoded character — the same "walk raw and decoded in lockstep" technique used
 * for JSX entities and markdown escapes, applied to JS's own escape sequences.
 *
 * Only the escapes that can appear in an ordinary prose string are handled: `\\`, `\'`, `\"`,
 * `` \` ``, `\n`, `\r`, `\t`, `\b`, `\f`, `\v`, `\0`, a line continuation (backslash immediately
 * followed by a newline, which contributes nothing to the value), `\xXX`, and `\uXXXX` /
 * `\u{X...}`. Legacy octal escapes (`\1`-`\7`) are deliberately not supported — they are a syntax
 * error in strict-mode source anyway, which all JSX/TSX is.
 */

export interface StringLiteralDecode {
  /** The literal's runtime value (no surrounding quotes, escapes resolved). */
  value: string
  /** Source offset of each character of `value`, relative to the start of `raw`. */
  offsets: Int32Array
  /** `'` or `"` or `` ` ``. */
  quote: string
}

function hexValue(raw: string, start: number, length: number): number | undefined {
  const slice = raw.slice(start, start + length)
  if (slice.length !== length || /[^0-9a-fA-F]/.test(slice)) return undefined
  return Number.parseInt(slice, 16)
}

/**
 * @param raw The literal's exact source text, quotes included (`node.start`..`node.end`).
 */
export function decodeStringLiteral(raw: string): StringLiteralDecode {
  const quote = raw[0]!
  const body = raw.slice(1, -1) // strip the surrounding quotes; offsets below are relative to `raw`.
  let value = ''
  const offsets: number[] = []
  let i = 0

  while (i < body.length) {
    const char = body[i]!
    if (char !== '\\') {
      value += char
      offsets.push(1 + i)
      i++
      continue
    }

    const next = body[i + 1]
    if (next === undefined) {
      // A trailing lone backslash: not valid, but do not throw here — the protocol's re-parse
      // step will refuse the write if this ever matters. Treat it as a literal backslash.
      value += char
      offsets.push(1 + i)
      i++
      continue
    }

    // Line continuation: backslash immediately followed by a line terminator contributes nothing.
    if (next === '\n') {
      i += 2
      continue
    }
    if (next === '\r') {
      i += body[i + 2] === '\n' ? 3 : 2
      continue
    }

    const simple: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      v: '\v',
      '0': '\0',
      "'": "'",
      '"': '"',
      '`': '`',
      '\\': '\\',
    }
    if (next in simple) {
      value += simple[next]!
      offsets.push(1 + i)
      i += 2
      continue
    }

    if (next === 'x') {
      const code = hexValue(body, i + 2, 2)
      if (code !== undefined) {
        value += String.fromCharCode(code)
        offsets.push(1 + i)
        i += 4
        continue
      }
    }

    if (next === 'u') {
      if (body[i + 2] === '{') {
        const close = body.indexOf('}', i + 3)
        if (close !== -1) {
          const code = Number.parseInt(body.slice(i + 3, close), 16)
          if (!Number.isNaN(code)) {
            const decoded = String.fromCodePoint(code)
            value += decoded
            for (let k = 0; k < decoded.length; k++) offsets.push(1 + i)
            i = close + 1
            continue
          }
        }
      } else {
        const code = hexValue(body, i + 2, 4)
        if (code !== undefined) {
          value += String.fromCharCode(code)
          offsets.push(1 + i)
          i += 6
          continue
        }
      }
    }

    // Not a recognized escape: keep the character after the backslash literally, matching what
    // the JS spec does for an unrecognized escape (the backslash is simply dropped).
    value += next
    offsets.push(1 + i)
    i += 2
  }

  return { value, offsets: Int32Array.from(offsets), quote }
}
