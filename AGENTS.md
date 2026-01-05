# AGENTS.md – Repository Guidelines & Commands

---

## 📦 Build / Lint / Test Commands

| Purpose | Command | Notes |
|---|---|---|
| **Install dependencies** | `npm ci` | Clean install using the lockfile. |
| **Build the library** | `npm run build` | Uses **vite** (`vite build`) to produce the distributable files in `dist/`. |
| **Run the full test suite** | `npm test` | Alias for `vitest`. Executes all tests under `tests/`. |
| **Run a single test file** | `npx vitest run path/to/file.test.js` | Replace `path/to/file.test.js` with the relative path from the repo root (e.g. `tests/lib/createCollection.test.js`). |
| **Run tests in watch mode** | `npx vitest watch` | Helpful during development. |
| **Run tests with coverage** | `npx vitest run --coverage` | Generates an HTML coverage report under `coverage/`. |
| **Lint (if added)** | `npm run lint` | *Not defined yet* – you can add an ESLint script (see **Adding Linting** below). |

### Adding Linting (optional)
If you decide to enforce linting, add the following dev‑dependency and script:
```bash
npm i -D eslint @eslint/js
# Create a basic config
printf "{\n  \"env\": {\n    \"node\": true,\n    \"es2022\": true\n  },\n  \"extends\": \"eslint:recommended\",\n  \"parserOptions\": {\n    \"sourceType\": \"module\"\n  }\n}\n" > .eslintrc.json
```
Then add to `package.json`:
```json
"scripts": {
  "lint": "eslint . --ext .js,.ts"
}
```
Run with `npm run lint`.

---

## 🎨 Code‑Style Guidelines
> These conventions are curated from the existing codebase and common best‑practices for a modern Node.js/ES‑module project.

### 1. General
- **Indentation** – 2 spaces, no tabs.
- **Line length** – ≤ 100 characters.
- **Trailing commas** – Use them for multiline literals/objects/arrays.
- **End‑of‑file newline** – Always present.
- **Quotes** – Use **double quotes (`"`) for string literals** and **single quotes (`'`) for import specifiers** (e.g., `import { foo } from './utils/foo.js'`).
- **Semicolons** – Do **not** use semicolons; rely on automatic ASI (the codebase currently follows this style).

### 2. Files & Modules
- All source files are **ES modules** (`"type": "module"` in `package.json`).
- File extensions **must be `.js`** (or `.ts` if TypeScript is added) and **explicitly referenced** in imports (e.g., `import { X } from './x.js'`).
- Keep one responsibility per file – a file should export either functions/classes **or** a single default export, not both.

### 3. Naming Conventions
| Entity | Convention |
|---|---|
| **Variables / Functions** | `camelCase` (e.g., `createCollection`, `checkBucketId`). |
| **Constants** | `UPPER_SNAKE_CASE` (e.g., `BUCKETID`, `INDEXNAME`). |
| **Classes / Constructors** | `PascalCase` (e.g., `Wrap`, `List`). |
| **Files** | `kebab-case.js` for general utilities, `camelCase.js` for domain‑specific modules (as currently used). |

### 4. Imports & Exports
- **Prefer named exports** unless a module truly represents a single entity.
- Order imports as: **builtin → external → internal**.
- Group related imports together and separate groups with a blank line.
```js
// builtin
import { readFile } from 'fs';

// external
import { expect } from 'chai';

// internal
import { checkCollection } from '../utils/checks.js';
```
- **Avoid circular dependencies** – keep utility functions pure and side‑effect free.

### 5. Types (JSDoc) – *Optional but recommended*
Even though the project does not use TypeScript, adding JSDoc improves IDE assistance.
```js
/**
 * Creates a new collection.
 * @param {string} collection - The collection name matching `COLLECTIONNAME` regex.
 * @throws {Error} When the collection already exists or validation fails.
 */
export async function createCollection(collection) { … }
```

### 6. Error Handling
- **Wrap low‑level errors** with context using the helper `Wrap(message, err)` from `utils/errors.js`.
- **Return early** on validation failures; do not deep‑nest `try/catch`.
- Use **specific error classes** (`List`, `Wrap`) rather than generic `Error` where possible.
- **Never swallow errors** – always re‑throw or propagate them.

### 7. Assertions & Validation
- Validation helpers are located in `utils/checks.js` and use **Chai’s `expect`**.
- All public API functions should **validate inputs** at the start and **return `true`** on success, otherwise **throw** the wrapped error.
- When writing new checks, follow the existing pattern:
```js
export function checkFoo(value) {
  try {
    expect(value).to.be.a('string');
    expect(value).to.match(FOOREGEX);
  } catch (e) {
    return e; // caller will treat this as a validation failure
  }
  return true;
}
```

### 8. Async/Await
- Prefer **async/await** over raw Promises for readability.
- All async functions should **`await`** their asynchronous calls; do not forget `return` after awaiting if a value is needed.
- Catch errors at the highest level of the async flow and wrap them.

### 9. Testing (Vitest)
- Test files live under `tests/` mirroring the source layout (`tests/lib/...`).
- Use **`describe` / `it`** blocks; keep each test **independent**.
- Assertions should use **Chai** (as the codebase already imports `expect` from `chai`).
- When testing async functions, use `await` and return a promise.
- Example snippet:
```js
import { expect } from 'chai';
import { createCollection } from '../../lib/createCollection.js';

describe('createCollection', () => {
  it('creates a new collection when valid', async () => {
    await createCollection('test-collection');
    // additional assertions…
  });
});
```

### 10. Commit Messages (for reference)
- **Subject line** ≤ 50 chars, capitalized, no period.
- **Body** explains *why* the change was made, not just *what*.
- Use conventional prefixes if desired (`feat:`, `fix:`, `refactor:`), but keep them short.

---

## 📂 Repository‑Specific Files
- **No `.cursor` or `Copilot` rule files were found** in this repository, so the above guidelines are the sole source of truth for agents.

---

*This document is intended for both human contributors and AI agents operating on the `facesdb` codebase. Following the conventions here will keep the project consistent, testable, and easy to maintain.*
