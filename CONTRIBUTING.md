# Contributing to MyChatBridge

Thank you for your interest in contributing! 🎉

## Getting Started

1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev:win   # Windows
   npm run dev       # macOS / Linux
   ```

## Development Workflow

- **Immutability**: always create new objects; never mutate existing state.
- **Error handling**: validate user input, surface friendly UI errors, and log detailed context server-side. Never silently swallow errors.
- **Security**: never commit secrets, keys, or credentials. Sanitize all external data.

## Adding a New Provider

See the detailed checklist in [AGENTS.md](AGENTS.md) ("Adding a New Provider" section). In short, a new provider touches 4 layers:

1. Provider config (`src/main/providers/builtin/<provider>.ts` + `src/main/store/types.ts`)
2. OAuth adapter (`src/main/oauth/adapters/<provider>.ts`)
3. Proxy adapter (`src/main/proxy/adapters/<provider>.ts` + stream handler)
4. UI translations + icon (`src/renderer/src/i18n/locales/*.json`, `src/assets/providers/<provider>.svg`)

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add X
fix: correct Y
docs: update Z
```

## Pull Requests

- Keep PRs focused; one feature or fix per PR.
- Make sure `npm run check:source-artifacts` and the test suite pass before submitting.
- Update `CHANGELOG.md` and relevant translations when adding user-facing changes.
- Update screenshots (`docs/screenshots/`) if you change UI.

## Issues

When reporting a bug, please include:

- OS and app version
- Steps to reproduce
- Expected vs actual behavior
- Relevant request logs (with sensitive data removed)

## License

By contributing, you agree that your contributions will be licensed under the GPL-3.0 license.
