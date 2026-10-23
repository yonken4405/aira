// Registers @testing-library/jest-dom's custom matchers (toBeInTheDocument,
// toHaveAttribute, toHaveClass, ...) onto vitest's `expect` for `tsc`.
// Colocated test files (.test.tsx) rely on these matcher types; without this
// ambient reference `tsc --noEmit` cannot see the module augmentation that the
// jsdom setup loads at runtime.
import '@testing-library/jest-dom/vitest';
