// Reading a cfg the user picked or dropped: when its encoding would garble HUD text, the user decides (EncodingDialog).
import { create } from 'zustand'
import { checkEncoding, type EncodingIssue } from '../hud/encoding'
import { bytesToText } from './io'

export type EncodingChoice = 'fix' | 'keep' | 'cancel'

interface Prompt {
  name: string
  issue: EncodingIssue
  answer: (choice: EncodingChoice) => void
}

export const useEncodingPrompt = create<{ prompt: Prompt | null }>(() => ({ prompt: null }))

// The cfg's text (one character per byte, as ezQuake reads it), or null when the user cancelled.
export async function readCfgFile(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const issue = checkEncoding(bytes)
  if (!issue) return bytesToText(bytes)
  const choice = await new Promise<EncodingChoice>((resolve) =>
    useEncodingPrompt.setState({
      prompt: {
        name: file.name,
        issue,
        answer: (c) => {
          useEncodingPrompt.setState({ prompt: null })
          resolve(c)
        },
      },
    }),
  )
  return choice === 'cancel' ? null : choice === 'fix' ? issue.fixed : bytesToText(bytes)
}
