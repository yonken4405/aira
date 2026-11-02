/**
 * Jest `setupFiles` shim: expose the CommonJS `require` and the screen-test directory as
 * `globalThis.require` / `globalThis.__dirname`.
 *
 * A few tests (e.g. `MedicalProfileScreen.test.tsx`'s R7.12 static-source assertion) read a
 * sibling source file through Node's `node:fs` / `node:path` to prove a module never imports
 * a forbidden native-permission package. `@types/node` is deliberately out of the mobile
 * tsconfig `types`, so those tests reach `require` / `__dirname` off `globalThis`. Under
 * jest's CommonJS runtime `require` is module-local (not on `globalThis`), so this setup
 * file — which DOES have a real `require` — publishes it, plus the absolute path of the
 * screen tests' `__dirname`, so `path.join(__dirname, '..', '<Screen>.tsx')` resolves to the
 * real screen source. Test infrastructure only; it adds no runtime behaviour to the app.
 */

const path = require('node:path');

const globalScope = globalThis;

if (typeof globalScope.require !== 'function') {
  globalScope.require = require;
}

// The screen tests live in `src/screens/__tests__`; their static-source assertions do
// `path.join(__dirname, '..', '<Screen>.tsx')` to reach `src/screens/<Screen>.tsx`.
globalScope.__dirname = path.join(__dirname, '..', 'src', 'screens', '__tests__');
