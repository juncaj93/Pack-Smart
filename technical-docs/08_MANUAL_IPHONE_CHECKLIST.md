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

### Packed and never worn

> Added in the second completion cycle. Only appears once there is history, so it
> cannot be seen on a fresh database.

- [ ] After three **finished** trips where the same thing was packed and you never
      marked it worn in During Trip, Settings → *What Pack Smart has noticed*
      offers to stop packing it.
- [ ] **It must not suggest anything from a trip where you never opened During
      Trip.** On such a trip everything looks unworn — if the panel ever offers to
      stop packing your whole wardrobe, that guard has failed and I need to know.
- [ ] It never offers to stop packing something marked essential.

### Removing clothing an outfit relies on (doc 04 §8)

> The one flow where two screens have to agree. Everything here works on a fresh
> database — approve one outfit first, so there is something to conflict with.

**On the packing list, with an approved outfit:**

- [ ] **⋯ → Not bringing this** on a garment from that outfit: the undo bar names
      the outfit — *"… · Safari was wearing it"* — and shows **Replace it** beside
      **Undo**. Both are easy to hit with a thumb, and the bar stays clear of the
      home indicator with the message wrapped onto three lines.
- [ ] After the bar disappears, a line **stays** on the list: *"Safari needs the
      … , which you are not bringing"*, with **Replace it**. If that line ever
      vanishes while the outfit is still short, tell me — a conflict you cannot see
      is the whole failure this exists to prevent.
- [ ] **Undo** clears both the row and that line.
- [ ] **Replace it** opens the same swap sheet the Outfits screen uses. Choosing a
      garment clears the line and adds the replacement to the list; the garment you
      set aside **stays** under Not bringing.
- [ ] Do the same to a **trip-only item you added by hand**: no **Replace it**, no
      standing line, nothing about outfits at all.

**On Outfits, while it is unresolved:**

- [ ] The card reads *"Incomplete — you are not bringing the …"* instead of *"On
      your packing list"*, and the garment is struck through with *"Not bringing
      this"* under it.
- [ ] Tapping that slot still opens the swap sheet.
- [ ] The approval itself is **not** silently withdrawn — the button still says
      **Undo approval**.

### The native-quality UX pass (`UX_AUDIT.md`)

> Automation measured the geometry at four widths and drove the gesture with real
> pointer events. What it cannot judge is how the swipe *feels*, so that is the
> first group here. Three actions per group, no more.

**Swipe to pack — the one that needs a real thumb:**

- [ ] Swipe a row right. The row follows your thumb, a check and *Pack* appear
      behind it, and it fills in once you are about half way across.
- [ ] Let go early, twice: once slowly and once as a quick flick. **Neither should
      pack the item.** If a flick packs something you only brushed, tell me — that
      threshold is the difference between an accelerator and a hazard.
- [ ] Scroll the list fast with your thumb wandering sideways. The list must scroll;
      no row should open.

**The trip screen:**

- [ ] The packing list is visible without scrolling, under the packed count and at
      most one warning.
- [ ] **Trip setup** opens the itinerary, day naming, One last look and Edit — and
      everything that used to be on this screen is still reachable.
- [ ] Scroll down: a section heading (*Pack later*, *Final check*) should never end
      up hidden behind the navigation.

**Home:**

- [ ] The next trip, the countdown, the progress and one obvious action, with the
      essentials line naming a few items rather than all of them.

### Part 3 — what the second UX pass changed

> Added after the first pass shipped its findings. Everything below was found by
> looking at the real product once the *evidence* was fixed — the visual run had
> been sharing a database with the end-to-end suite, and two "empty state"
> screenshots were pictures of the populated screen (`UX_AUDIT.md`, "The evidence
> was wrong before the product was"). These are the checks a screenshot still
> cannot settle.

**Home now carries three more sections (doc 02 §4):**

- [ ] Below the featured trip and its action: **Also coming up** listing your other
      planned trips by name, a **Plan a Trip** button, then **Recent trips**.
- [ ] Tapping any of those rows opens that trip.
- [ ] **Plan a Trip** opens the sheet **on Home** — it should not bounce you to the
      Trips screen first.
- [ ] The page ends naturally after **All trips**. No band of empty background.
- [ ] While a trip is underway, **nothing on Home says the same thing twice.** The
      card and the button below it used to both read *See what to wear today*.

**The trip screen while it is loading or failing:**

- [ ] On a slow connection, opening a trip shows grey placeholder blocks in the
      shape of the screen — not a blank page. *(Easiest to see on cellular with a
      weak signal, or by opening a trip you have not viewed before.)*
- [ ] Turn on Airplane Mode and open a trip you have **never** opened: it should say
      *Could not load this trip*, that nothing was changed, and offer **Try again**.
- [ ] Turn Airplane Mode off and tap **Try again**. The trip loads **without leaving
      the screen**. If that button ever does nothing, tell me.

**Dark appearance — the palette had never been looked at before this pass:**

- [ ] Switch iOS to Dark and open a trip. The **essentials alert reads as an alert**
      — visibly warmer and more urgent than the neutral note beneath it. This is the
      one that was wrong: in Dark the two panels were indistinguishable.
- [ ] Open the row sheet (**⋯**) in Dark. The sheet separates clearly from the page
      behind it.
- [ ] Home, Trips, My Stuff, Outfits and Settings in Dark: no text that has gone
      grey on grey, no border that has vanished, nothing that looks inverted rather
      than designed.
- [ ] Switch back to Light and confirm nothing there changed.

---

### Part 4 — the V2 slices

> Everything the V2 work shipped that a screenshot or an assertion cannot settle.
> Grouped so it is **one phone session**, not one interruption per release.

**The swipe — THE BLOCKING GATE, and three actions is the whole of it.**

> PR #30's swipe hotfix passed every automated gate and was unusable on the
> phone. So this is not a checklist item among others: the gesture does not
> merge until these three are confirmed, and nothing else in this section is
> worth doing until they pass.
>
> Do it on the **Preview URL** from the Preview workflow, not on production. A
> *Gesture check* panel is on screen there; it reports what the phone actually
> did, so if something is wrong, **read the panel back rather than opening
> developer tools**.

- [ ] **1. Swipe one unpacked item RIGHT.** It follows your thumb, the action
      fills in behind it past about half the row, and letting go packs it.
- [ ] **2. Swipe one item LEFT.** The *How many* and red ✕ tray latches open and
      stays. Tapping elsewhere on the row closes it without packing anything.
- [ ] **3. Scroll vertically, starting the drag ON a row.** The list scrolls
      normally.

      **Expected across all three: no jitter, both horizontal actions reach
      their action, vertical scrolling is unaffected.**

Only once those three pass, the rest of the gesture's feel:

- [ ] The settle should **arrive** rather than drift — tuned to about a tenth of
      a second for a full travel. **If it feels abrupt rather than crisp, say
      so**; the three numbers to turn are named in `swipe/recognizer.ts`.
- [ ] Swipe a row while your thumb **drifts down the screen** as it travels. The
      row must still settle. (Touch events give this for free through implicit
      capture; the pointer model needed `setPointerCapture` and lost it to
      `pointercancel`, which is what #30 broke on.)
- [ ] Pack a row by swiping. It should **finish moving before** the list resorts
      it into *Packed* — not vanish mid-travel.
- [ ] **Scroll the packing list fast.** No red ✕ should flash across rows as they
      appear. This was reported and fixed; it is a one-frame effect, so no
      screenshot can confirm it either way.
- [ ] Press and hold any button. It should **shrink slightly** the instant your
      finger lands, not just change colour.

**The packing list's explanations, with VoiceOver on — one unverifiable claim:**

- [ ] Turn VoiceOver on and swipe through the packing list. Each row should
      announce the **item name first**, then its state, then the explanation as a
      *description* after a pause. If the explanation is read as part of the name
      — before you hear "button" — the `aria-labelledby` split has regressed.
- [ ] **Listen to a row carrying arithmetic**, such as Contacts: `12 nights × 2
      = 24`. **If VoiceOver drops the `×` and `=` and reads "12 nights 2 24",
      say so** — three unrelated numbers is worse than no explanation, and the
      fix is a spoken form on the description while the visible glyphs stay.
      This is the one C1 claim no automated check could settle: iOS punctuation
      verbosity is not reproducible in WebKit automation.
- [ ] Open the ⋯ sheet on any row. *Why it is here* should never be empty, and
      the small uppercase labels above each paragraph should be comfortably
      readable in **both** Light and Dark.

**Temperatures — no automated run has ever seen a real forecast:**

- [ ] Open a trip with a destination and dates inside the forecast window. The
      summary reads in **°F**, and the number is plausible for that place and time
      of year.
- [ ] An outfit card for a planned day shows the conditions **for that day and that
      stop** — on a multi-city trip, Cape Town's temperature must not appear above
      a Kruger outfit.
- [ ] A trip far enough out to be a climate normal says **"Usually"**. This is the
      single way weather can mislead, and nothing here has ever seen one.

**Appearance:**

- [ ] Settings → **Appearance**: pick Light while the phone is in Dark. The app
      stays Light, including after force-quitting and reopening — **no flash of the
      wrong colour** as it launches.
- [ ] Safari's toolbar and status bar match the app, not the phone.
- [ ] Pick **System** again and change the phone's setting: the app follows.
- [ ] The sun/moon in the header and the row in Settings always agree.

**Finding things:**

- [ ] My Stuff opens **grouped by category**. Scrolling to a heading does not slide
      it under the sticky navigation.
- [ ] The filter and sort dropdowns open the **iOS wheel**, and the page does not
      zoom when they do.
- [ ] On the packing list, **Still to pack** while you are actually packing. The
      count above it must keep counting the whole trip, not the filtered view.
- [ ] **Pack day of** on the morning you leave.

**Density, with a keyboard up — the half no browser can test:**

- [ ] Settings → *Your usual amounts*: all your amounts and **Add an amount** fit
      without scrolling.
- [ ] My Stuff → **+** → tap **Name**. With the keyboard raised, is **Add to My
      Stuff** still reachable? This is the one open item from `UX_AUDIT` U5 and it
      **cannot be answered anywhere but on the phone**.
