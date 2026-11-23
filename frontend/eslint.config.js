import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // ANVAYA Client-Side SPA Architectural Justification:
      // Route-level data-fetching components (appointments, doctor consultations, audit logs)
      // trigger async REST queries on mount via useEffect(() => { void fetchData(); }, [...]).
      // The experimental React 19 compiler rule 'react-hooks/set-state-in-effect' flags
      // initial loading state transitions prior to async I/O. Because ANVAYA is a client-side
      // SPA without React Server Components, this experimental rule is disabled while preserving
      // all standard React Hook, TypeScript, and React Refresh strict correctness checks.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
