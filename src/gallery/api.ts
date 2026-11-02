// Shared HUD gallery on Supabase (docs/SHARED-HUDS.md, supabase/migrations).
// Authors are identified by a secret kept in this browser; the admin signs in by e-mail link.
import { createClient, type PostgrestError } from '@supabase/supabase-js'
import { create } from 'zustand'

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Arrived from the admin's e-mail sign-in link (read before the client consumes the URL hash).
export const openedFromSignInLink = /access_token=|error_description=/.test(location.hash)

// Without the two values (local builds, forks) the gallery is simply absent.
export const galleryEnabled = !!(URL_ && KEY)
const db = galleryEnabled ? createClient(URL_!, KEY!) : null

export interface SharedHud {
  id: string
  name: string
  author: string
  updated_at: string
}

export const LIMITS = { name: 40, author: 24 }

// ---------------------------------------------------------------- author identity

const SECRET_KEY = 'qw-hud-editor:author-key'
const NICK_KEY = 'qw-hud-editor:nick'
const SHARES_KEY = 'qw-hud-editor:shares' // timestamps of recent shares, for the per-browser limit
const SHARES_PER_HOUR = 5

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      // not remembered
    }
  },
}

export const getSecret = () => storage.get(SECRET_KEY)

function ensureSecret(): string {
  let secret = getSecret()
  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(18))
    secret = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    storage.set(SECRET_KEY, secret)
  }
  return secret
}

export const getNick = () => storage.get(NICK_KEY) ?? ''
export const setNick = (nick: string) => storage.set(NICK_KEY, nick)

// ---------------------------------------------------------------- errors

// Turns database errors into sentences for the UI.
function explain(error: PostgrestError | Error | null): string | null {
  if (!error) return null
  const code = 'code' in error ? error.code : ''
  const msg = error.message ?? ''
  if (code === '23505') return 'That name is already taken. Choose another one.'
  if (code === '23514') return `Name (1-${LIMITS.name} characters), nick (1-${LIMITS.author}) and HUD size (200 KB) have limits.`
  if (/rate limit/.test(msg)) return 'Too many HUDs were shared in the last hour. Please try again later.'
  if (/not allowed/.test(msg)) return "You can only change HUDs you shared from this browser (or restored with a recovery code)."
  if (/fetch|network/i.test(msg)) return "Couldn't reach the gallery. Check your connection."
  return msg || 'Something went wrong.'
}

export class GalleryError extends Error {}

async function call<T>(run: () => PromiseLike<{ data: T; error: PostgrestError | null }>): Promise<T> {
  if (!db) throw new GalleryError('The shared gallery is not set up for this site.')
  let result: { data: T; error: PostgrestError | null }
  try {
    result = await run()
  } catch (e) {
    throw new GalleryError(explain(e as Error)!)
  }
  if (result.error) throw new GalleryError(explain(result.error)!)
  return result.data
}

// ---------------------------------------------------------------- store

interface GalleryState {
  huds: SharedHud[]
  mine: Set<string> // ids shared with this browser's secret
  status: 'off' | 'loading' | 'ok' | 'error'
  refresh(): Promise<void>
}

export const useGallery = create<GalleryState>((set) => ({
  huds: [],
  mine: new Set(),
  status: galleryEnabled ? 'loading' : 'off',
  async refresh() {
    if (!db) return
    try {
      const [huds, mine] = await Promise.all([
        call(() => db.from('shared_huds').select('id,name,author,updated_at').order('name')),
        getSecret() ? call(() => db.rpc('my_huds', { p_secret: getSecret() })) : Promise.resolve([] as string[]),
      ])
      set({ huds: (huds ?? []) as SharedHud[], mine: new Set(mine as string[]), status: 'ok' })
    } catch {
      set({ status: 'error' })
    }
  },
}))

const refresh = () => useGallery.getState().refresh()

// ---------------------------------------------------------------- operations

export async function fetchSharedCfg(id: string): Promise<string> {
  const row = await call(() => db!.from('shared_huds').select('cfg').eq('id', id).single())
  return (row as { cfg: string }).cfg
}

export async function shareHud(name: string, author: string, cfg: string): Promise<void> {
  const recent = JSON.parse(storage.get(SHARES_KEY) ?? '[]').filter((t: number) => Date.now() - t < 3600_000)
  if (recent.length >= SHARES_PER_HOUR) throw new GalleryError(`You can share up to ${SHARES_PER_HOUR} HUDs per hour.`)
  await call(() => db!.rpc('share_hud', { p_name: name, p_author: author, p_cfg: cfg, p_secret: ensureSecret() }))
  storage.set(SHARES_KEY, JSON.stringify([...recent, Date.now()]))
  setNick(author)
  await refresh()
}

// Name, author or cfg; omitted fields stay as they are. Works for the author, or the signed-in admin.
export async function updateHud(id: string, changes: { name?: string; author?: string; cfg?: string }): Promise<void> {
  await call(() =>
    db!.rpc('update_hud', { p_id: id, p_secret: getSecret() ?? '', p_name: changes.name ?? null, p_author: changes.author ?? null, p_cfg: changes.cfg ?? null }),
  )
  await refresh()
}

export async function deleteHud(id: string): Promise<void> {
  await call(() => db!.rpc('delete_hud', { p_id: id, p_secret: getSecret() ?? '' }))
  await refresh()
}

// Adopts a recovery code (the secret from another browser). Returns how many HUDs it owns.
export async function recover(code: string): Promise<number> {
  const secret = code.trim()
  const ids = (await call(() => db!.rpc('my_huds', { p_secret: secret }))) as string[]
  if (ids.length) {
    storage.set(SECRET_KEY, secret)
    await refresh()
  }
  return ids.length
}

// ---------------------------------------------------------------- admin

export async function adminSendLink(email: string): Promise<void> {
  const { error } = await db!.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } })
  if (error) throw new GalleryError(error.message)
}

export async function adminEmail(): Promise<string | null> {
  const { data } = await db!.auth.getSession()
  return data.session?.user.email ?? null
}

export const isAdmin = async () => (await call(() => db!.rpc('admin_status'))) as boolean

export async function adminSignOut(): Promise<void> {
  await db!.auth.signOut()
}

export async function adminDeleteAuthor(author: string): Promise<number> {
  const n = (await call(() => db!.rpc('admin_delete_author', { p_author: author }))) as number
  await refresh()
  return n
}

export async function adminDeleteAll(): Promise<number> {
  const n = (await call(() => db!.rpc('admin_delete_all'))) as number
  await refresh()
  return n
}
