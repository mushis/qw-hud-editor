import { useState } from 'react'

// The browser's author secret, shown so it can be kept and used in another browser.
export function RecoveryCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="recovery">
      <p>
        <b>Recovery code.</b> Keep it somewhere safe: it lets you update or delete your shared HUDs from another browser or after
        clearing this one. Anyone with the code can change them.
      </p>
      <div className="recovery-row">
        <code>{code}</code>
        <button
          type="button"
          onClick={() =>
            navigator.clipboard.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
