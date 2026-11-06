import { useState } from 'react'
import logo from '../assets/brand/logo-320.jpg'
import { AdminPanel } from '../gallery/AdminPanel'
import { galleryEnabled, useVisitors } from '../gallery/api'
import { Modal } from './Modal'

// Double-clicking the logo opens the admin panel (sign-in by e-mail link).
export function About({ onClose, admin: startAdmin = false }: { onClose: () => void; admin?: boolean }) {
  const [admin, setAdmin] = useState(startAdmin)
  const visitors = useVisitors((s) => s.total)

  return (
    <Modal label="About" onClose={onClose} wide>
      <img
        className="about-logo"
        src={logo}
        alt="QuakeWorld HUD Editor"
        width={160}
        height={160}
        onDoubleClick={() => galleryEnabled && setAdmin(true)}
      />
      {visitors !== null && (
        <p className="about-visitors" title="Counted once per browser">
          {visitors.toLocaleString('en-US')} {visitors === 1 ? 'visitor' : 'visitors'}
        </p>
      )}
      <p className="about-credits">
        Version {__VERSION_DATE__} · made by mushi, vibe coded with Claude ·{' '}
        <a href="https://github.com/mushis/qw-hud-editor" target="_blank" rel="noreferrer">
          source on GitHub
        </a>
      </p>
      {admin && <AdminPanel />}
      <p>
        Edits the ezQuake HUD (<code>scr_newhud 1</code>). The HUD is a set of <code>hud_&lt;element&gt;_&lt;setting&gt;</code> cvars, and
        this editor reads and writes exactly those.
      </p>

      <h3>Loading and saving</h3>
      <ul>
        <li>
          <b>Load / save HUD</b> lists the presets, an <i>empty</i> HUD (everything hidden, every setting at its default) and the{' '}
          <b>shared HUDs</b> everyone has published (★ marks yours).
        </li>
        <li>
          <b>Share current HUD…</b> publishes the HUD, with its settings, under a name and your nick: everyone can load it at once. Sharing
          again under the same name updates it. <b>My shared HUDs…</b> renames, updates or deletes the ones you shared from this browser.
          The first time you share, you get a <b>recovery code</b>: keep it to manage your HUDs from another browser.
        </li>
        <li>
          <b>Import cfg</b>, or drop a <code>.cfg</code> file anywhere on the page, to open your own HUD or config. Only HUD cvars are read
          (plus the settings below); everything else is ignored, and so are HUD cvars this ezQuake doesn't have. Settings the file leaves
          out get their ezQuake defaults. A short message sums up what was loaded.
        </li>
        <li>
          <b>Export cfg</b> saves the HUD as a file, with the date and time in its header. Put it in your ezQuake folder and load it in game
          with <code>exec &lt;file&gt;</code>.
        </li>
        <li>
          <b>Textures</b>: drop images (<code>num_0.png</code>, <code>sb_shells.tga</code>…), a <code>gfx.wad</code>, a zip/pk3, or a
          whole folder (such as <code>qw/textures/wad</code>) to replace the HUD pictures by name, add group pictures (
          <code>gfx/&lt;name&gt;</code>) or a charset. When a name exists more than once, the file ezQuake would load wins (
          <code>textures/wad</code> before <code>gfx</code>; <code>.tga</code>, then <code>.png</code>, then <code>.jpg</code>). Each load
          gets its own <i>N custom · name ✕</i> button that removes just that set; newer sets cover older ones. They are kept in this
          browser.
        </li>
        <li>Your work is saved in this browser automatically, so it is still there after a reload.</li>
      </ul>

      <h3>Editing</h3>
      <ul>
        <li>
          <b>Select</b> an element by clicking it on the screen or in the list on the left. The filter box narrows the list; the checkbox
          turns the element on or off (<code>show</code>). Where elements overlap, click again to cycle through them.
        </li>
        <li>
          <b>Drag</b> to move it (changes <code>pos_x</code> / <code>pos_y</code>). Arrow keys nudge by 1, Shift+arrow by 10.
        </li>
        <li>
          The panel on the right edits every setting of the selected element. Settings that differ from the ezQuake default are highlighted
          and ↺ resets one; invalid values are in red. <b>Reset</b> sets the whole element back to its defaults, and <b>Copy from…</b>{' '}
          copies the settings it shares with another element (all but whether it is shown). Number boxes step with ▲▼ or the arrow keys
          (Shift = ×10) and stop at 0, except positions, <code>order</code>, the game clock <code>offset</code>, the fps <code>drop</code> and the frags
          spacing, which ezQuake takes below 0. Colours have a picker and one box per channel.
        </li>
        <li>
          <b>View as</b> previews the HUD as a player, a spectator or in a demo. Elements that don't show in that view are in italics in the
          list. Tags mark elements that only show when spectating (<i>spec</i>), in demos (<i>demo</i>) on the scoreboard (<i>score</i>) or during a map vote (<i>vote</i>),
          and the elements and settings only unezquake has (<i>unez</i>: <code>totalstrength</code>, <code>mapvote</code>, the armor
          <code>text_color_*</code>); ezQuake ignores those.
        </li>
        <li>
          <b>Issues</b>, under the screen, lists enabled elements that won't look as intended: off-screen or cut off, hidden because they
          are placed on a hidden element, or using an invalid value, and a resolution the cfg set that the editor can't use (like 0×0). Off-screen
          elements also get a red marker on the screen edge.
        </li>
        <li>
          On the screen, hold <b>Ctrl</b> to drag the selected element's corners: that changes its scale (or width and height for groups and
          bars). Hold <b>Alt</b> while dragging an element placed on another one to move both, or one that others are placed on to move only
          it. Right-click for moves to an edge, unanchoring and reset. The bar under the screen shows what the mouse and keys do right now.
        </li>
        <li>Fit / 2× / 4× zooms the screen; the zoom and the scroll position are kept when you reload. Ctrl+Z and Ctrl+Y undo and redo.</li>
        <li>
          <b>Export setup</b> saves a zip with the HUD as a named cfg and the pictures loaded into the editor (HUD pictures, charset, crosshair,
          group pictures), laid out like the <code>qw</code> folder to extract it into.
        </li>
      </ul>

      <h3>Settings</h3>
      <p className="dim">
        These change the whole HUD, not one element. Positions and sizes are in virtual pixels, not screen pixels, and these settings decide
        how many virtual pixels the screen has. Tick <i>export</i> to write them into the exported cfg as well.
      </p>
      <dl>
        <dt>Resolution</dt>
        <dd>
          The game window size (<code>vid_width</code> × <code>vid_height</code>). On its own it doesn't change the layout: the HUD is drawn
          at resolution ÷ conscale.
        </dd>
        <dt>conscale</dt>
        <dd>
          <code>vid_conscale</code>. 1920×1080 with conscale 2 gives a 960×540 HUD. A higher value means fewer virtual pixels, so everything
          looks bigger.
        </dd>
        <dt>con W × H</dt>
        <dd>
          <code>vid_conwidth</code> × <code>vid_conheight</code> set the virtual size directly and override conscale. If their proportions
          differ from the window's, the game stretches the HUD, and so does the editor. A loaded HUD that sets them switches the editor to
          its values; one that doesn't goes back to <i>auto</i> (conscale).
        </dd>
        <dt>viewsize</dt>
        <dd>
          The status bar height used by the <code>sbar</code>, <code>ibar</code> and <code>hbar</code> places (and their <code>*free</code>{' '}
          counterparts): 48 pixels at 100, 24 at 110, none at 120. Below 100 the 3D view shrinks and is centred above the status bar,
          with the backtile pattern around it; the <code>view</code> place shrinks with it, the others don't.
        </dd>
      </dl>

      <h3>How to build a HUD that works at any resolution</h3>
      <ul>
        <li>
          <b>Anchor first, then nudge.</b> Choose <code>place</code> and <code>align_x</code> / <code>align_y</code> so the element sits
          where it belongs (for example <code>screen</code>, <code>center</code>, <code>bottom</code>), and only then use <code>pos_x</code>{' '}
          / <code>pos_y</code> for small adjustments. A HUD built from big offsets off the top-left corner only fits the screen size it was
          made on.
        </li>
        <li>
          <b>Anchor to the nearest edge.</b> Things in a corner align to that corner; things in the middle use <code>center</code>. Then a
          wider or taller screen moves them with the edge instead of leaving them behind.
        </li>
        <li>
          <b>Chain related elements.</b> Place the health number <code>after</code> the face, the armor icon <code>before</code> it, and so
          on. Move the first one and the rest follow, and they never drift apart.
        </li>
        <li>
          <b>Use groups as frames.</b> A group is an invisible box you can place elements inside (<code>@group1</code>). Position the group
          once; everything in it moves together.
        </li>
        <li>
          <b>Check several sizes.</b> Switch the resolution and conscale (16:9, 16:10, 4:3) and look at the Issues panel: nothing should be
          cut off or off-screen.
        </li>
        <li>
          <b>Resize with scale.</b> The alignment is worked out from the element's size, so a <code>center</code>- or <code>right</code>
          -aligned element grows in place when you change <code>scale</code>, and you don't need to fix its position afterwards.
        </li>
      </ul>

      <h3>Disclaimer</h3>
      <p className="dim">
        The layout follows ezQuake's own placement code, but the editor is not the game. Fonts, custom textures and charsets, the game
        state, and elements drawn as mock-ups (frags, teaminfo, radar, netgraph…) are approximations. It is not guaranteed that the HUD will
        look exactly the same in game, so check it there before you play.
      </p>
    </Modal>
  )
}
