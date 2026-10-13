// Shared Vitest setup for every workspace package.
//
// Component suites opt into jsdom with a `@vitest-environment jsdom` docblock;
// this file only adds matchers that are safe in both environments.
import '@testing-library/jest-dom/vitest';
