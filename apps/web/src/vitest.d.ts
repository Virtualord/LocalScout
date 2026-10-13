/**
 * Vitest global types.
 *
 * The jest-dom matchers (`toBeInTheDocument`, `toHaveFocus`, ...) augment
 * `expect`, which only takes effect if they are in the program. They cannot be
 * pulled in through `compilerOptions.types` because the augmenting types live in
 * the package's `vitest` entry rather than its root, so this reference is the
 * supported way to get them.
 */
/// <reference types="@testing-library/jest-dom/vitest" />
