// ezQuake reads cfgs byte by byte: each byte is one character of the charset (Quake's high-bit brown text, fun
// chars). A cfg saved by a text editor as UTF-8 or UTF-16 turns those characters into two or more bytes each,
// which the game (and this editor) would draw as other glyphs. Here the bytes are checked for that.

export type EncodingKind = 'utf16' | 'utf8' | 'bom' | 'lost'

export interface EncodingIssue {
  kind: EncodingKind
  message: string // what is wrong, in a sentence
  fixed: string // the cfg as ezQuake expects it (one byte per character)
  cvars: string[] // HUD cvars it changes
}

const HUD_LINE = /^\s*(?:(?:set|seta|setu)\s+)?(hud_\w+|scr_newhud)\b/i

// Characters past the charset's 256 become "?"; the U+FFFD replacement character (a character an editor already
// lost) is dropped.
const toBytes = (s: string) =>
  Array.from(s.replace(/�/g, ''), (ch) => (ch.charCodeAt(0) > 0xff ? '?' : ch)).join('')

function issue(kind: EncodingKind, message: string, original: string, fixed: string): EncodingIssue | null {
  const before = original.split(/\r?\n/)
  const after = fixed.split(/\r?\n/)
  const cvars = new Set<string>()
  before.forEach((line, i) => {
    const m = line.match(HUD_LINE) ?? after[i]?.match(HUD_LINE)
    if (m && line !== after[i]) cvars.add(m[1].toLowerCase())
  })
  // A BOM breaks the first command whatever it is; otherwise only changes to HUD lines matter here.
  return cvars.size || kind === 'utf16' ? { kind, message, fixed, cvars: [...cvars] } : null
}

export function checkEncoding(bytes: Uint8Array): EncodingIssue | null {
  const latin1 = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    const text = new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(bytes)
    return issue('utf16', 'It was saved as UTF-16 (Unicode), so ezQuake reads two bytes for every character and none of it works.', latin1, toBytes(text))
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = bom ? bytes.subarray(3) : bytes
  if (body.some((b) => b >= 0x80)) {
    let text: string | null = null
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    } catch {
      // not UTF-8: high bytes are Quake characters, as ezQuake expects
    }
    if (text !== null) {
      const lost = text.includes('�')
      return issue(
        lost ? 'lost' : 'utf8',
        lost
          ? 'It was saved as UTF-8, and some characters were already lost (replaced by a question-mark symbol) when it was saved.'
          : 'It was saved as UTF-8, so each Quake character (brown text, symbols) is two bytes and shows as two wrong ones.',
        latin1,
        toBytes(text),
      )
    }
  }
  // A marker before the first command breaks that line; it only matters here when the line is a HUD cvar.
  const first = bom && latin1.slice(3).match(HUD_LINE)
  return first ? { kind: 'bom', message: 'It starts with a UTF-8 marker (BOM), which breaks its first line.', fixed: latin1.slice(3), cvars: [first[1].toLowerCase()] } : null
}
