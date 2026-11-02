// Extracts HUD_Register(...) calls from ezQuake C sources.
// Each argument becomes { str } for string literals (adjacent literals joined),
// { null: true } for NULL, or { expr } for anything else.

const STRING = /"(?:\\.|[^"\\])*"/y

function unescapeC(s) {
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, e) => {
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16))
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8))
    return { n: '\n', r: '\r', t: '\t' }[e] ?? e
  })
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|("(?:\\.|[^"\\])*")/g, (m, str) => str ?? m.replace(/[^\n]/g, ' '))
}

function toArg(text) {
  const a = text.trim()
  if (a === 'NULL') return { null: true }
  if (/^("(?:\\.|[^"\\])*"\s*)+$/.test(a)) {
    return { str: [...a.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => unescapeC(x[1])).join('') }
  }
  return { expr: a }
}

export function parseRegisterCalls(source) {
  const src = stripComments(source)
  const calls = []
  const re = /\bHUD_Register\s*\(/g
  let m
  while ((m = re.exec(src))) {
    if (/hud_t\s*\*\s*$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue // the definition
    let i = re.lastIndex
    let depth = 1
    let cur = ''
    const args = []
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '"') {
        STRING.lastIndex = i
        const lit = STRING.exec(src)[0]
        cur += lit
        i += lit.length
        continue
      }
      if (c === '(') depth++
      else if (c === ')') depth--
      if (depth === 0 || (c === ',' && depth === 1)) {
        args.push(toArg(cur))
        cur = ''
      } else cur += c
      i++
    }
    calls.push({ line: src.slice(0, m.index).split('\n').length, args })
  }
  return calls
}
