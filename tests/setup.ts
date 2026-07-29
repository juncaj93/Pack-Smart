import '@testing-library/jest-dom/vitest'

// jsdom has no layout engine, so scrollTo is unimplemented and logs a noisy
// "Not implemented" for every BottomSheet close. The scroll-restore behaviour
// it stands in for is verified on a real engine by the Playwright suite.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}
