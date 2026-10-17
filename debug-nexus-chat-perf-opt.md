npm run dev# Debug Session: nexus-chat-perf-opt
**Status**: [OPEN] | Waiting User Verification
**Session ID**: nexus-chat-perf-opt
**Created**: 2026-09-09

## Overview
Debugging and optimizing Nexus Chat application performance. Focus areas: bundle size, unnecessary re-renders, component memoization, data fetching efficiency, and session restoration bugs.

## Symptoms Confirmed
- ✅ Production bundle 517KB (>500KB Vite warning) — **chunk splitting deployed**
- ✅ AuthContext value recreation on every render — **useMemo + useCallback deployed**
- ✅ MessageBubble + ChatListItem re-render O(n) on any parent state change — **React.memo with custom comparator deployed**
- ✅ useSetting hook: 3 call sites with independent localStorage state — **SettingsContext single source of truth deployed**
- ✅ checkAuth() session restoration: `LIMIT 1` without filter — **bug fixed: now rehydrates from stored member_id**

## Hypotheses Disposition
| ID | Hypothesis | Status | Evidence |
|----|-----------|--------|----------|
| H1 | AuthContext value recreation → cascading re-renders | ✅ CONFIRMED & FIXED | `value` was inline object → now `useMemo`; all handlers wrapped in `useCallback` |
| H2 | Missing React.memo → O(n) list re-renders | ✅ CONFIRMED & FIXED | MessageBubble + ChatListItem now `memo()` with custom `areEqual` comparators |
| H3 | 517KB bundle → no code splitting | ✅ CONFIRMED & FIXED | `vite.config.js` now has 8 manual chunk groups (vendor, query, supabase, ui, icons, forms, util, radix) |
| H4 | useSetting N independent reads | ✅ CONFIRMED & FIXED | New `SettingsContext.jsx` with single shared store; old hook re-exports |
| H5 | checkAuth LIMIT 1 arbitrary user | ✅ CONFIRMED & FIXED | Session now rehydrates correct user via `.eq('member_id', storedNexusId)` with fallback to local cache |

## Instrumentation & Fix Files
1. [AuthContext.jsx](file:///c:/Users/User$/Desktop/Nexus-Chat/src/lib/AuthContext.jsx#L66-L294) — useMemo value, useCallback handlers, session restoration fix
2. [SettingsContext.jsx](file:///c:/Users/User$/Desktop/Nexus-Chat/src/lib/SettingsContext.jsx) — NEW: shared settings store
3. [useSetting.js](file:///c:/Users/User$/Desktop/Nexus-Chat/src/hooks/useSetting.js) — backward-compatible re-export
4. [App.jsx](file:///c:/Users/User$/Desktop/Nexus-Chat/src/App.jsx#L22-L64) — SettingsProvider wired at root
5. [MessageBubble.jsx](file:///c:/Users/User$/Desktop/Nexus-Chat/src/components/chat/MessageBubble.jsx) — memo + custom comparator + useMemo content
6. [ChatListItem.jsx](file:///c:/Users/User$/Desktop/Nexus-Chat/src/components/chat/ChatListItem.jsx) — memo + custom comparator + useMemo time
7. [ChatView.jsx](file:///c:/Users/User$/Desktop/Nexus-Chat/src/components/chat/ChatView.jsx) — useCallback handlers, incremental E2EE decryption with cancellation
8. [ChatLayout.jsx](file:///c:/Users/User$/Desktop/Nexus-Chat/src/layouts/ChatLayout.jsx) — useMemo activeTab + showMobileSidebar, useCallback handleTabChange
9. [vite.config.js](file:///c:/Users/User$/Desktop/Nexus-Chat/vite.config.js#L13-L37) — 10-way manual chunks, sourcemap off
10. [query-client.js](file:///c:/Users/User$/Desktop/Nexus-Chat/src/lib/query-client.js) — gcTime: 30min, retry: 1, no refetchOnWindowFocus

## Additional Fixes
- Wallpaper defaults aligned: ChatView, SettingsContext, AppearanceSettings all use `'nature'` (was split `'default'` vs `'nature'`)
- E2EE decryption loop: now filters to pending messages only, adds cancel-on-unmount, batches results with Promise.all

## Build Verification
- `npx vite build` → **exit code 0 (SUCCESS)**
- `GetDiagnostics` → **0 errors, 0 warnings**

## Next: User Verification
Please run the app and confirm:
1. Login flow works (user restored correctly on page refresh)
2. Chat messages render smoothly without jank
3. Settings (wallpaper) persist across routes without flicker
4. No console errors
