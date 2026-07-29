# Pack Smart — Manual iPhone Checklist

Status: **Required before any milestone is called complete.**

`06_RISK_REGISTER.md` R11 is permanent and unclosable: CI cannot run iOS Safari.
Playwright WebKit approximates it but reproduces neither ITP storage policy, PWA
standalone mode, safe-area insets, nor the native date wheel. `05_MILESTONE_PLAN.md`
opens by saying a milestone is complete only when its user-facing criteria are
verified against the running app — **never because the code compiles**.

Run this on a real iPhone in Safari. Record the date, the iOS version, and any
failure.

---

## M0 — Foundation

### Install and launch

- [ ] **1.** The site loads in iPhone Safari over https.
- [ ] **2.** Share → **Add to Home Screen** shows the **Pack Smart suitcase icon**,
      not a screenshot thumbnail. *(This is what the `apple-touch-icon` link tag
      is for; iOS ignores the manifest icons here.)*
- [ ] **3.** Launching from the Home Screen opens **full screen, with no Safari
      chrome** — no address bar, no toolbar.
- [ ] **4.** Content is not clipped by the notch or Dynamic Island, and top
      spacing looks deliberate in standalone mode.

> **Covers M0 acceptance criterion 1** — installs to the Home Screen and
> launches standalone.

### Layout

- [ ] **5.** The bottom nav sits **above the home indicator**, not under it.
- [ ] **6.** No screen scrolls sideways. Try each of the four tabs.
- [ ] **7.** All four tab targets are comfortable one-handed, standing.
- [ ] **8.** Rotating to landscape and back leaves no clipped or overlapping content.
- [ ] **9.** With the keyboard open on the Unlock screen, nothing important is
      hidden behind it.

> **Covers M0 acceptance criteria 3 and 4** — no horizontal scroll, and the nav
> clears the home indicator.

### Input zoom

- [ ] **10.** Tapping the passphrase field **does not zoom the page**. If the page
      zooms and stays zoomed, an input is under 16px — that is a defect, not a
      preference.

> **Covers the second half of M0 acceptance criterion 3.**

### Session persistence

- [ ] **11.** Unlock with the real passphrase. The four-tab shell appears.
- [ ] **12.** Force-quit the app (swipe up from the app switcher) and reopen it.
      Still signed in.
- [ ] **13.** Restart the iPhone entirely. Reopen. **Still signed in.**
- [ ] **14.** Reopening returns to the tab last used, not always Home.
- [ ] **15.** **Leave the app untouched for eight days, then reopen. Still signed
      in.** *(Diarise this. It is the half of acceptance criterion 2 that cannot
      be verified on day one — see the note below.)*

> **Covers M0 acceptance criterion 2** — session survives a week of disuse and a
> phone restart.

### Bottom sheet

- [ ] **16.** Settings → **About Pack Smart** opens the sheet from the bottom edge.
- [ ] **17.** It dismisses by tapping the backdrop.
- [ ] **18.** It dismisses by dragging the grabber down.
- [ ] **19.** It dismisses via **Done**.
- [ ] **20.** Sheet content clears the home indicator.
- [ ] **21.** The page behind the sheet does not scroll or rubber-band while it
      is open, and the scroll position is unchanged after closing.

### Feel

- [ ] **22.** Navigation is immediate — no visible lag, no layout shift on load.
- [ ] **23.** Nothing depends on hovering.
- [ ] **24.** Dark mode looks deliberate, not inverted.

---

## A note on criterion 2, stated plainly

The phone-restart half (item 13) is testable immediately. The week-of-disuse half
(item 15) **cannot be verified in an afternoon by anyone.**

What is verified now is the mechanism that makes it true, asserted in
`tests/unit/worker/routes.test.ts`: the cookie is **server-set**, `HttpOnly`,
`Secure`, `SameSite=Lax`, `Max-Age=31536000`. WebKit's ~7-day cap applies to
*JavaScript-set* cookies; a server-set `HttpOnly` cookie persists to its stated
expiry. That is precisely why `01_ARCHITECTURE.md` §4 requires it.

Until item 15 is actually ticked, **M0 acceptance criterion 2 is partially
verified, not passed.** Do not record it as passed on day one.

---

## Record of runs

| Date | iOS version | Items failed | Notes |
|---|---|---|---|
| | | | |

---

## Part 2 — the product screens

Added once trips, outfits, the checklist and During Trip existed. The automated suite covers
these under Chromium at 390×844; what it cannot cover is real WebKit rendering, the native date
wheel, the home indicator, ITP storage policy, and standalone PWA behaviour. So they are here.

Run these from the Home Screen icon, not from Safari with the address bar showing.

### Planning a trip

- [ ] Tapping **Plan a Trip** opens the sheet from the bottom; it does not fill the whole screen.
- [ ] Tapping the **Leaving** field opens the native iOS date wheel, and the page does not zoom.
- [ ] Picking a return date before the start shows the error on the field, not as an alert.
- [ ] The two date fields sit side by side without the sheet scrolling sideways.
- [ ] Activity chips are comfortable to tap one-handed and clearly show which are on.
- [ ] The "Not answered — nothing will be assumed" line appears under an unanswered question, and
      tapping the chosen answer again clears it.

### The packing list

- [ ] The day count in the subtitle matches the dates — 31 Jul to 11 Aug reads **12 days**.
- [ ] Contacts show **24**, with "12 days × 2 = 24" underneath.
- [ ] One tap on a row marks it packed; the row does not jump under your thumb.
- [ ] Tapping **⋯** opens the row sheet; the − and + targets are easy to hit without looking.
- [ ] **Not bringing this** shows the undo bar above the tab bar, clear of the home indicator.
- [ ] Undo restores the row.
- [ ] The essentials warning names the items and does not shout.

### Outfits

- [ ] **Plan Outfits** produces groups by occasion, not one card per day.
- [ ] An empty slot states what is missing instead of showing a placeholder garment.
- [ ] Tapping a slot opens the swap sheet with suitable garments first and the rest below,
      each with a reason.
- [ ] **Approve outfit** adds its clothing to the packing list; undoing removes it again.
- [ ] Approving an incomplete outfit says why it cannot be approved.

### During the trip

- [ ] With nothing packed, Today says so rather than suggesting clothes.
- [ ] With the outfit packed, Today shows one top, one bottom, one pair of shoes — not the
      whole group's allocation.
- [ ] **Bring** is a short list of things worth carrying, not the entire bag.
- [ ] The day arrows move between days and the plan does not change when you come back.
- [ ] "Too warm" offers something else you actually packed.

### Offline — do this one on a plane or in Airplane Mode

> **This section is the acceptance test for offline reads, not a spot check.**
> No automated test covers this on WebKit: Playwright cannot simulate a lost connection to a
> service worker in that engine, so the checks below are the only real evidence that offline
> reads work on the device. See `09_IMPLEMENTATION_NOTES.md` §4.1. Until these pass, treat
> offline reads as unverified.

- [ ] Open the trip with signal, then turn on Airplane Mode and force-quit the app.
- [ ] Reopening from the Home Screen still shows the trip and its packing list.
- [ ] The offline line appears at the top and reads as information, not as an error.
- [ ] Turning Airplane Mode off makes the line disappear without a reload.

### Settings

- [ ] **Your usual amounts** steppers are easy to hit and the number updates immediately.
- [ ] **Packing rules** describes each rule in plain words — nothing reads like code.
- [ ] Any rule Pack Smart could not understand appears at the top, quoting the spreadsheet.
