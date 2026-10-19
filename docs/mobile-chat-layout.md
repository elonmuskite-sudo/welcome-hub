# Mobile Chat Layout — Fixes, Test Matrix & Edge Cases

Scope: mobile (≤ `md` breakpoint) chat messaging section — composer, emoji/sticker
picker, attachment selector, bottom navigation, and per-viewer chat naming.

Goal: the chat messaging section stays fixed to the bottom of the viewport,
sits 8px above the bottom navigation with zero overlap from 320px to 480px wide,
and the composer always renders fully visible above the on-screen keyboard.

---

## 1. Audit — root causes found

| # | Root cause | Symptom | Fix |
|---|------------|---------|-----|
| 1 | Composer toolbar mixed `w-9 h-11` (sticker, attach = 36px wide) with `w-11 h-11` (send = 44px) under `items-end` | Icon buttons and send button visually misaligned on the baseline / inconsistent gutters | All toolbar icon buttons normalized to `w-11 h-11`; form gap set to `gap-2` (8px) |
| 2 | `ChatLayout` used a hardcoded `pb-[76px]` while `AppBottomNav` renders its own safe-area spacer (`h-[max(env(safe-area-inset-bottom),0.75rem)]`) | Assumed nav height disagreed with real nav height → composer could be covered by the nav (esp. devices with a home indicator) | Replaced with a measured, JS-driven `--chat-bottom-offset` (`padding-bottom: var(--chat-bottom-offset, 84px)`) |
| 3 | No keyboard handling existed anywhere | Soft keyboard covered the composer; typed text obscured | Added `useViewportInsets` (`visualViewport`-based) + composer autogrow |
| 4 | `StickerPicker` was absolutely positioned (`absolute bottom-full … z-50`) | Picker could be clipped by the keyboard/nav or overlap the message list | Moved inline into the composer flow (`mb-2 w-full …`), height-capped and internally scrollable |
| 5 | `chats.title` was always written as the recipient's name at creation | Sender saw the correct name; the recipient saw their **own** name | Added `chats.participant_names` (jsonb) + viewer-relative `chatDisplayName(chat, viewerId)` |
| 6 | `ChatLayout` was pinned to `h-[100dvh]` (layout viewport) while the composer cleared `max(navHeight + 8, keyboardInset)` | On Android the keyboard shrinks the *visual* viewport only, so the inset stayed ~0 and the composer sat under the keyboard; on iOS the document scrolled and the box left the screen | Shell height now tracks `--vv-height` (`.chat-shell`) and `--chat-bottom-offset` is a single 8px gap while the keyboard is open |

---

## 2. Files changed

| File | Change |
|------|--------|
| [src/hooks/useViewportInsets.js](file:///c:/Users/User$/Downloads/welcome-hub/src/hooks/useViewportInsets.js) | **New.** Publishes `--vv-height`, `--keyboard-inset`, `--bottom-nav-height`, `--chat-bottom-offset`, and toggles the `keyboard-open` class. |
| [src/layouts/ChatLayout.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/layouts/ChatLayout.jsx) | Calls the hook; root is `.chat-shell`; content padding is `pb-[var(--chat-bottom-offset,72px)] md:pb-0`. |
| [src/components/chat/AppBottomNav.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/components/chat/AppBottomNav.jsx) | Adds `data-chat-bottom-nav` so the nav can be measured. |
| [src/components/chat/MessageInput.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/components/chat/MessageInput.jsx) | 8px gaps, uniform `w-11 h-11` buttons, textarea autogrow with `min(40vh,180px)` cap, `chat-composer` safe-area padding. |
| [src/components/chat/StickerPicker.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/components/chat/StickerPicker.jsx) | Inline in composer flow; `max-h-[min(40vh,220px)]` + internal scroll. |
| [src/components/chat/ChatView.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/components/chat/ChatView.jsx) | Re-scrolls to bottom on keyboard resize; header name uses `chatDisplayName`; header, search bar, message list and error bar use the shared `.chat-page-x` gutter; list is `overflow-x-hidden`. |
| [src/components/chat/MessageBubble.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/components/chat/MessageBubble.jsx) | Bubble padding normalized to `px-3.5 py-2.5 sm:px-4 sm:py-3`. |
| [src/layouts/ChatLayout.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/layouts/ChatLayout.jsx) | Bottom padding fallback aligned to the documented `72px`. |
| [src/components/chat/ChatListItem.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/components/chat/ChatListItem.jsx) | Adds `chatDisplayName`; list row, avatar `alt` and memo comparator use it. |
| [src/lib/persistence.js](file:///c:/Users/User$/Downloads/welcome-hub/src/lib/persistence.js) | Reads/writes `participant_names` on `chats`. |
| [src/components/chat/ChatSidebar.jsx](file:///c:/Users/User$/Downloads/welcome-hub/src/components/chat/ChatSidebar.jsx) | Passes `participantNames` when creating a chat. |
| [src/index.css](file:///c:/Users/User$/Downloads/welcome-hub/src/index.css) | Declares layout vars (incl. the responsive `--chat-page-pad`); `.chat-page-x`, `.chat-composer`, `.chat-textarea` component classes. |
| [supabase/migrations/20261017010000_chat_participant_names.sql](file:///c:/Users/User$/Downloads/welcome-hub/supabase/migrations/20261017010000_chat_participant_names.sql) | Adds `chats.participant_names jsonb` + idempotent backfill. |

---

## 3. How the layout works

CSS custom properties on `:root`, written by `useViewportInsets`:

| Var | Meaning | Default |
|-----|---------|---------|
| `--chat-gap` | Standardized spacing unit | `8px` |
| `--chat-page-pad` | Horizontal gutter for the messaging surface (responsive, see §4) | `12px` |
| `--vv-height` | Height of the *visible* viewport; the mobile app shell height | `100dvh` |
| `--bottom-nav-height` | Measured height of `[data-chat-bottom-nav]` | `64px` |
| `--keyboard-inset` | px obscured by the on-screen keyboard | `0px` |
| `--chat-bottom-offset` | `navHeight + 8` while the keyboard is closed, `8` while it is open | `72px` |

- **App shell height:** `.chat-shell` is `100dvh` on desktop and `var(--vv-height)`
  on mobile, so the shell always ends at the visible bottom edge of the screen.
  The composer is the last flex child, so it can never be pushed off-screen.
- **Keyboard height** = `window.innerHeight - visualViewport.height - visualViewport.offsetTop`,
  clamped to `0` below a 24px threshold so mobile URL-bar show/hide jitter is not
  mistaken for a keyboard (iOS keeps `innerHeight` and shrinks the visual viewport).
- **Android keyboard detection:** Chrome resizes the layout viewport instead of
  overlaying it, so there the difference above is ~0 and the keyboard is detected
  as the viewport shrinking >140px below the tallest keyboard-free height seen for
  the current orientation (the baseline is reset whenever the width changes).
- **While typing (`keyboard-open` class on `<html>`):** the shell already ends at the
  keyboard, so the composer only needs the 8px rhythm and the bottom navigation is
  hidden — otherwise a fixed nav would sit on top of the composer.
- **Recomputation triggers:** `visualViewport` `resize` + `scroll`, `window` `resize`,
  `orientationchange`, and a `ResizeObserver` on the bottom nav. All writes are
  coalesced into a single `requestAnimationFrame`. The nav is hidden while typing,
  which reports a 0 height; the last real measurement is kept so the
  closed-keyboard offset stays correct.
- **Composer bottom padding** therefore becomes `env(safe-area-inset-bottom)` via the
  content wrapper (`pb-[var(--chat-bottom-offset)]`), guaranteeing the 8px gap above the
  nav and that the composer jumps above the keyboard.

---

## 4. Mobile padding scale (320–768px)

The messaging surface has **one** horizontal gutter, driven by `--chat-page-pad`
on `:root`. It steps up with the viewport so the layout uses the app's existing
4px/8px rhythm instead of ad-hoc values:

| Viewport width | `--chat-page-pad` | Rationale |
|---|---|---|
| 320–359px | `12px` | 320px floor (iPhone SE 1st gen); keeps the composer textarea usable next to four 44px buttons |
| 360–639px | `16px` | App's standard mobile gutter — Galaxy S24 (360), iPhone SE 2/3 (375), iPhone 15 (393) |
| ≥ 640px (`sm`) | `24px` | App's desktop gutter (`px-4 sm:px-6`), reused inside the desktop chat shell |

Every full-width row uses the `.chat-page-x` helper, which applies
`max(var(--chat-page-pad), env(safe-area-inset-*))` so a landscape notch or
rounded corner widens the gutter when it needs to and never clips content.

| Element | Applied padding |
|---|---|
| Contact header | `.chat-page-x` + `py-2 sm:py-3` |
| Search bar | `.chat-page-x` + `py-3` |
| Message list container | `.chat-page-x` + `py-5` (+ `overflow-x-hidden`) |
| Send-error alert | `.chat-page-x` + `py-2` + `break-words` |
| Composer (`.chat-composer`) | vertical `--chat-gap` (8px), horizontal `--chat-page-pad` |
| Message bubble | `px-3.5 py-2.5 sm:px-4 sm:py-3` |

Notes:

- The header, search bar, message list and composer therefore share identical
  left/right gutters, so bubbles line up with the composer textarea.
- Message bubbles sit **inside** the list gutter, so a bubble is never against a
  screen edge: minimum text inset is `12 (gutter) + 14 (bubble) = 26px` at 320px.
- No horizontal overflow: the list has `overflow-x-hidden`, every flex child that
  can hold long content is `min-w-0`, text uses `break-words`/`whitespace-pre-wrap`,
  and file names, reply previews and headers use `truncate`.
- Widths after padding at the smallest target (320px): list content `296px`,
  bubble `≤ 85%` → `≤ 251px`, composer textarea `≈ 96px` (four 44px buttons +
  three 8px gaps = 200px).
- The composer's 8px bottom gap above the bottom navigation is unchanged; only the
  horizontal gutter was raised from 8px to match the rest of the surface.

---

## 5. Verification

Automated (executed in this environment):

| Check | Result |
|-------|--------|
| `npx vite build --mode development` | ✅ Passed — 0 errors (chunk-size advisory only) |
| ESLint | ✅ 0 errors (5 pre-existing `react-refresh/only-export-components` warnings) |
| VS Code diagnostics | ✅ No problems |
| Migration applied to linked project | ✅ `chats.participant_names` present; recorded in `supabase_migrations.schema_migrations` |

Manual device checks (require a physical device / simulator — **not** executable from
this environment; listed so they can be run before release):

| Device / browser | Portrait | Landscape | Keyboard open | Picker expanded | Long compose |
|---|---|---|---|---|---|
| iPhone SE — Safari | ☐ | ☐ | ☐ | ☐ | ☐ |
| iPhone 14/15 — Safari | ☐ | ☐ | ☐ | ☐ | ☐ |
| Samsung Galaxy — Chrome | ☐ | ☐ | ☐ | ☐ | ☐ |
| Google Pixel — Chrome | ☐ | ☐ | ☐ | ☐ | ☐ |
| 320px small / 480px phablet widths | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## 6. Edge cases handled

- **Keyboard on iOS vs Android:** iOS is detected from the shrinking visual
  viewport (+ `offsetTop` for its visual-viewport scroll), Android from the
  layout-viewport shrink against the orientation's keyboard-free baseline.
- **Composer off-screen:** impossible now that the shell height tracks the visible
  viewport — the composer is the shell's last flex child, not a fixed element
  positioned from the bottom of the document.
- **URL-bar jitter:** suppressed by the 24px minimum-inset threshold and the 140px
  shrink threshold.
- **Bottom nav vs composer while typing:** the nav is hidden (`keyboard-open`) so it
  cannot overlap the composer, and its measured height is preserved for the
  closed-keyboard offset.
- **Notch / home indicator / landscape cut-outs:** `env(safe-area-inset-*)` used on
  the composer's left/right padding and the nav's bottom spacer.
- **Very small screens (320px):** 44px buttons + `gap-2` still leave the textarea
  usable because it is `flex-1 min-w-0`.
- **Very large screens (480px, `md`):** composer/nav remain mobile-only; the content
  wrapper resets to `md:pb-0`.
- **Long composition:** textarea grows to `min(40vh, 180px)` then scrolls internally,
  so it never pushes the send button or the message list off-screen.
- **Picker expanded:** `max-h-[min(40vh,220px)]` with `overflow-y-auto`; inline in the
  composer so it is never clipped by the keyboard or nav.
- **Rotation:** `orientationchange` triggers a recompute.
- **Dynamic UI / network load states:** nav height is re-measured via `ResizeObserver`,
  and `ChatView` re-scrolls to the newest message on keyboard resize.
- **Viewer-relative naming:** sender sees the recipient's name; recipient sees the
  sender's name (peer resolved from `participant_ids`, name looked up in
  `participant_names`), falling back to `chats.title` for groups / legacy chats.

---

## 7. Open items

- **Supabase MCP** `integrated_web-dev` returns `Forbidden (500000)`; migration work
  was done with the Supabase CLI instead.
- **`.env` project alignment (resolved):** `woavhlkgylarngqyvphf` ("Nexus Next") is
  authoritative — it holds the applied schema and the CLI link
  (`supabase/.temp/linked-project.json`, `supabase/config.toml`). The `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PROJECT_ID`, and anon-key values in `.env`/`.env.production` now point at
  it too, so the browser client and `/api` functions cannot split across projects.
- **`scripts/lib/supabase-schema.js`** bootstrap expects a different schema model
  (`members.profile_id`, `current_member_profile_id()`, `nexus_schema_migrations`) and
  is unreconciled with the live schema.
