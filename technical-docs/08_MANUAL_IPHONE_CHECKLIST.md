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
      *(Margin is now deliberately thin — see "The 61px tab bar" below.)*
- [ ] **6.** No screen scrolls sideways. Try each of the four tabs.
- [ ] **7.** All four tab targets are comfortable one-handed, standing.
- [ ] **8.** Rotating to landscape and back leaves no clipped or overlapping content.
- [ ] **9.** With the keyboard open on the Unlock screen, nothing important is
      hidden behind it.

> **Covers M0 acceptance criteria 3 and 4** — no horizontal scroll, and the nav
> clears the home indicator.

### Safari is the primary experience — run these there first

> The bottom tab bar has been **removed**, along with the 16px-capped inset that
> came with it. It sat directly above Safari's own toolbar and read as two
> competing navigation bars. Navigation is now a compact row beneath the page
> title. The previous "tap the very bottom edge of each tab" check is gone with
> the bar it tested — there is nothing there to mis-tap any more.

**In normal Safari:**

- [ ] **Safari's toolbar is the only thing at the bottom.** No Pack Smart bar is
      stacked above it.
- [ ] Scrolling down **collapses Safari's toolbar**, and scrolling up brings it
      back — the way any website behaves. *(This is the check CI cannot do: a
      headless browser has no toolbar to collapse.)*
- [ ] The page **ends naturally** at the bottom. No grey or white band of empty
      background where the old bar used to be.
- [ ] A **short** page (Settings) and a **long** one (My Stuff) both look right —
      a short page is where a leftover spacer would show.
- [ ] The navigation row sits under the page title, and the **current section is
      obvious** at a glance.
- [ ] Each of the four is comfortable to hit one-handed.
- [ ] No content is hidden behind Safari's chrome at either end.

**Check every screen**, since the layout primitive changed for all of them:

- [ ] Home  - [ ] Trips  - [ ] My Stuff  - [ ] Settings
- [ ] Trip detail  - [ ] Outfits  - [ ] Packing checklist

**In the Home Screen app**, confirm it is the *same* layout, not a second one:

- [ ] The same top navigation appears, in the same place.
- [ ] Content clears the home indicator at the bottom of a long page.
- [ ] Nothing is fixed to the bottom of the screen.

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

### Multi-city, rain and formality

- [ ] On a new trip, **Going to more than one place?** reveals a second stop with arrive/leave
      dates. A single-destination trip looks exactly as it did.
- [ ] Give two stops real dates in different climates, plan outfits, and check the cold city's days
      are not dressed for the warm one.
- [ ] **A trip more than two weeks out** shows a temperature range that says *"This is the usual
      weather, not a forecast"*. **If it ever reads like a forecast, stop and say so** — that is
      the one way this feature can mislead.
- [ ] **Dressiest thing you are doing** appears on the trip sheet and tapping the chosen level again
      clears it.
- [ ] Set it to Casual and confirm nothing dressier is suggested — but a Wedding activity still
      gets dressy clothes.
- [ ] On a forecast with rain, the jacket slot either names something you have recorded as
      waterproof, or says plainly that nothing is. **It must never nominate an ordinary jacket.**

### Trip history

- [ ] A trip whose end date has passed appears under **Past trips** and no longer says "Planning".
- [ ] **Plan again** on a past trip opens the sheet with the name, destination, icon and activities
      already filled in.
- [ ] **The dates are empty.** Fill in new ones and save.
- [ ] It creates a NEW trip — the old one is still in the list.
- [ ] The new trip's packing list starts unpacked, with no outfits approved and no old forecast.

### Settings

- [ ] **Your usual amounts** steppers are easy to hit and the number updates immediately.
- [ ] **Add an amount** finds an item by typing three or four letters, and the stepper that
      follows is comfortable one-handed.
- [ ] **Remove** takes the row away and the **Undo** beside it puts it back.
- [ ] A number changed here actually changes the next trip's list. *(Set contacts to 3, plan a
      trip of 4 days, and check the list says 12 — not 8. This is the half that used to be
      broken: the stepper moved and nothing else did.)*
- [ ] **Packing rules** describes each rule in plain words — nothing reads like code.
- [ ] Any rule Pack Smart could not understand appears at the top, quoting the spreadsheet.

### My Stuff

- [ ] The **+** sits beside the **My Stuff** heading and is visible the moment the screen opens.
- [ ] It is comfortable to hit one-handed, even though the drawn square is small.
- [ ] It takes no row of its own, and there is **no second Add button** further down the page.
- [ ] Adding an item needs only a name and a category; everything else is optional.
- [ ] **Archive** removes it from the list and **Show archived** brings it back.

### Trip icons

- [ ] Creating a trip with **Safari** selected suggests 🦁 before you save.
- [ ] The icon appears beside the trip name on the trip card, the trip screen, and Home.
- [ ] Tapping the icon opens a short grid; choosing a different one sticks.
- [ ] **Editing the trip afterwards — adding an activity, changing the dates — does not change
      the icon back.** This is the half that would be easy to get wrong.
- [ ] A trip with nothing distinctive gets ✈️ rather than a wrong guess.
- [ ] The icon reads as part of the name, not as a large graphic competing with it.

### Itinerary import

> Two of these can only be checked on the real site. The build environment cannot reach the open
> internet, so **no test has ever fetched a real page**. See `09_IMPLEMENTATION_NOTES.md` §6.

- [ ] From a trip, **Add an itinerary** opens the three choices: text, link, PDF.
- [ ] Pasting a dated itinerary lists the activities and the days, each quoting the line it came
      from.
- [ ] An activity that runs on three days reads **3 days**, not once.
- [ ] Unticking something and then adding leaves that one off the trip.
- [ ] **Add these to the trip** lands on Outfits with the right number of each outfit.
- [ ] Pasting something that is not an itinerary says nothing was found rather than inventing a
      trip.
- [ ] **A real link** — try a public itinerary or a blog post with dates. It should either read it
      or say plainly why it could not.
- [ ] **A link that needs a login** — an airline confirmation. It should say it opened a sign-in
      page, not that the itinerary was empty.
- [ ] **A real PDF itinerary** from a booking. It should read it, or say the PDF's text could not
      be read. **If it silently produces nonsense dates, stop and say so** — that is the failure
      mode worth catching.
- [ ] A photographed or scanned PDF says it holds pictures rather than text.

### Outfits you approve are remembered

> Approving an outfit now records that those clothes go together, and favours the
> pairing on later trips (doc 04 §5). It is the only ordinary action on that
> screen that writes something outliving the trip, so it must say so.

- [ ] Approving an outfit shows **"Remembered that these go together, for future
      trips"** with an **Undo** beside it.
- [ ] **Undo** makes the line disappear — and the outfit **stays approved**. The
      two are separate: you keep the outfit, you decline the habit.
- [ ] Tapping **Undo approval** instead shows no "remembered" line at all.
- [ ] The Undo button is comfortable to hit one-handed.
- [ ] On a **later** trip, an outfit reason sometimes reads *"You approved this
      with <garment> before"*. **It must name a real garment you own** — if it
      ever names something you do not have, or reads like a guess about style or
      colour, stop and say so.
- [ ] **The top is not affected.** Pairings change trousers, shoes and layers,
      never which shirt is picked first — that is the anchor (doc 04 §5). Not a
      bug to report.

### Which days are what

- [ ] From a trip with activities chosen, **Say which days are what** opens a row per date.
- [ ] Only the activities chosen for this trip appear as chips — not all eleven.
- [ ] One tap sets a day; tapping the same chip again clears it back to "an ordinary day".
- [ ] The chips wrap instead of scrolling sideways, and the page never scrolls sideways.
- [ ] **Save and replan outfits** lands on Outfits, and an activity given three days shows as
      **3 days** rather than **Once**.
- [ ] An outfit already approved is left alone by the replan.

### Weather — the part that could not be tested before release

> **This section is the acceptance test for weather.** The build environment cannot reach
> Open-Meteo at all, so nothing in CI has ever seen a real forecast. See
> `09_IMPLEMENTATION_NOTES.md` §5. Until these pass, treat weather as built but unverified.

- [ ] Plan a trip to a real place starting within the next two weeks, then tap **Outfits** and
      **Plan Outfits**.
- [ ] Go back to the trip. A line near the top gives a temperature range — for example
      "8° to 19°C while you are there".
- [ ] The range is plausible for that place at that time of year. **If it is wildly wrong, stop
      and say so** — it means the destination was geocoded to the wrong place.
- [ ] On a trip more than about two weeks out, the line instead says the dates are too far ahead
      for a forecast. It should never show a temperature it does not have.
- [ ] With no forecast at all, outfits still plan normally and nothing on screen mentions weather.

### What a trip is not covering, and what Pack Smart has noticed

> Two additions from the completion cycle. Neither needs the network, so both are
> fully testable — they just cannot be exercised from the build environment.

**On a trip screen:**

- [ ] With everything covered, **no coverage panel appears at all.** Silence is
      the normal state.
- [ ] Mark something in My Stuff as essential and give it no rule. The trip says
      *"<name> is marked essential, but no rule will ever add it to a packing
      list"* and suggests the fix.
- [ ] It names **your** item, never a generic category, and it never adds
      anything to your inventory by itself.
- [ ] **It never says you have no medication.** Owning none is allowed — if you
      ever see a warning about something you do not need, tell me, because that
      is the failure that makes the useful ones get ignored.

**In Settings → What Pack Smart has noticed:**

- [ ] With a fresh history it reads *"Nothing yet"* rather than showing an empty
      panel.
- [ ] After taking the same item off **three** separate trips, it offers to stop
      adding it, and says how many trips it saw.
- [ ] **Stop adding it** works, and Packing rules can turn it back on.
- [ ] It never offers to stop adding something marked essential.
