# Shared HUD gallery

Status: built (`src/gallery/`, `supabase/migrations/20261102_shared_huds.sql`). Recovery codes: yes. Admin: mushis@gmail.com.

Replaces "Save current HUD…" (per-browser) with a gallery that every visitor sees.

## Requirements (agreed)

| | |
|---|---|
| Who can share | Anyone, no account |
| Moderation | None before publishing: a shared HUD is public at once; the admin removes bad ones afterwards |
| Stored per HUD | Name, author nick (plus the cfg and dates) |
| Authors | Can update and delete their own HUDs |
| Extras | None (no votes, counts, featured) |
| Per-browser saves | Removed; "Share" replaces "Save current HUD…" |

## Backend: Supabase

A hosted Postgres with a REST API, free tier (500 MB database, which is far more than needed: a HUD cfg is about 50 KB, roughly 10 KB compressed). The static site talks to it directly from the browser; there is no server of our own.

- **You** create the Supabase project (free, sign in with GitHub) and own it. The site needs two values from it, the project URL and the public "anon" key, which go into the build as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. The anon key is public by design; what it may do is limited by the database rules below.
- The database schema and rules live in this repo as a SQL migration (`supabase/migrations/…sql`), applied once in the Supabase dashboard.
- Without the two values (local development, forks), the gallery is hidden and the rest of the editor works as now.

## Data

```
huds
  id          uuid, primary key
  name        text, 1–40 chars
  author      text, 1–24 chars (nick)
  cfg         text, max 200 KB (the exported cfg, settings included)
  created_at  timestamp
  updated_at  timestamp
  edit_key    text, SHA-256 of the author's secret (never readable)
```

Names are unique ignoring case, so the list never shows two "carapace" entries.

## Owning a HUD without an account

When someone shares a HUD, the browser generates a random secret, keeps it in localStorage, and sends only its hash to the database. Updating or deleting the HUD later requires the secret, so:

- the author can update or delete it **from the same browser** they shared it from;
- the editor shows "yours" next to those HUDs, and an **Update** / **Delete** action for them;
- if they clear their browser data or switch computers, they lose that right; only the admin can then change it. (Optionally, the editor can show the secret once as a "recovery code" to copy somewhere. Your call.)

The database enforces this through three functions (`share_hud`, `update_hud`, `delete_hud`) that check the secret. The table itself is read-only to visitors, and the `edit_key` column is never returned.

## Admin

The hidden admin dialog (double-click the logo in About) stays, but the password check moves to Supabase: you sign in with your email (a one-time link), and the database accepts rename/delete from that account only. Rename, delete and delete all work on every HUD. This replaces the password hash in the site's code, which anyone could read.

## Abuse

With anonymous, immediate publishing, the realistic risks are spam and offensive names. Protection in v1:

- size and length limits (above) enforced by the database;
- at most 5 shares per hour from the same browser, plus a database-side cap of 30 new HUDs per hour overall;
- the admin can delete anything; "Delete all from this author" for clean-ups.

If spam becomes a real problem later, Cloudflare Turnstile (an invisible captcha, free) can be added to sharing.

## In the editor

- **Load / save HUD…** dropdown: *Presets* (as now) and *Shared HUDs* (name — author, sorted by name, "★ yours" marked), then **Share current HUD…**.
- **Share current HUD…** asks for a name and a nick (the nick is remembered). If the name is one of your own HUDs, it offers to update it instead.
- Loading a shared HUD works like a preset (settings included, rest at defaults).
- A small "Manage my HUDs" entry lists your own shared HUDs with Rename / Update with current / Delete.
- The gallery is fetched when the page opens and on opening the dropdown; if Supabase can't be reached, the presets still work and the list says so.

## Not in v1

Screenshots/thumbnails, search, tags, votes, download counts, comments.

## Setup (once, in the Supabase dashboard)

1. **SQL Editor > New query**: paste `supabase/migrations/20261102_shared_huds.sql` and run it.
2. **Authentication > URL Configuration**: Site URL = the published site (e.g. `https://mushis.github.io/qw-hud-editor/`); add Redirect URLs `http://localhost:5173/**` and `https://mushis.github.io/**`. The admin sign-in link only returns to these.
3. Sign in once as admin (About > double-click the logo > e-mail link). Then, optionally, **Authentication > Sign In / Providers**: turn off "Allow new users to sign up", so nobody else can create accounts (they couldn't do anything with them anyway).

The site reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env` (public values, committed with the site). To change the admin, edit the e-mail in `hud_is_admin()` and run that function again.

## Implementation notes

- One secret per browser (not per HUD): every HUD shared from that browser shares the secret, so one recovery code covers all of them. Recovering a code on a browser that already has its own replaces it (the user is warned).
- A recovery code is the secret itself; it is only shown to its owner (after the first share, and in "My shared HUDs…").
- The "5 shares per hour" limit is per browser and enforced by the editor; the 30-per-hour cap is enforced by the database.
