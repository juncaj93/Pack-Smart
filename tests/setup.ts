import '@testing-library/jest-dom/vitest'

// jsdom has no layout engine, so scrollTo is unimplemented and logs a noisy
// "Not implemented" for every BottomSheet close. The scroll-restore behaviour
// it stands in for is verified on a real engine by the Playwright suite.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}

/*
 * Pointer capture, which jsdom does not implement at all.
 *
 * `BottomSheet` captures the pointer on drag start so a swipe that leaves the
 * grabber still reaches the sheet — correct on every real engine, and a
 * `TypeError` in jsdom, where `Element.setPointerCapture` simply does not
 * exist. The throw happens inside React's event dispatch, so it does not fail
 * the test that caused it: vitest reports it as an **uncaught exception** and
 * exits non-zero with every assertion still green.
 *
 * That is exactly how it got past a local run. `2140 passed` was true and the
 * two `Errors` lines under it were not read, so the run was called green when
 * its exit code said otherwise. CI read the exit code.
 *
 * Stubbed here rather than guarded in `BottomSheet`, because the product code
 * is right: the API exists everywhere the app actually runs. What is missing is
 * a piece of the DOM in the test environment, and supplying it is this file's
 * job — as it already is for `scrollTo`.
 */
if (typeof Element !== 'undefined') {
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false

  /*
   * `scrollIntoView`, missing for the same reason `scrollTo` is: no layout
   * engine, so nothing to scroll. `BottomSheet` calls it on the focused field
   * when the software keyboard shortens the sheet under it, and the throw
   * arrives inside a `visualViewport` listener — off React's stack entirely,
   * where it fails the run without failing a test.
   *
   * Stubbed rather than guarded, on the same grounds as the three above: the
   * method exists on every engine the app runs on, and whether the field is
   * actually brought into view is a question only a real one can answer.
   */
  Element.prototype.scrollIntoView ??= () => {}
}
