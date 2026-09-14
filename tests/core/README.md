# Core Gateway Abstractions Tests

Run these tests with Node's built-in test runner (Node 22+, supports running `.ts` directly):

```bash
node --test tests/core/*.test.ts
```

Or the full suite:

```bash
node --test "tests/**/*.test.ts"
```

These cover the `src/main/proxy/core/` abstractions:
- Provider runtime contract and adapter bridge (`provider-contract.test.ts`)
- Instance layer and health state machine (`instance.test.ts`)
- Pluggable router strategies (`router.test.ts`)
- Capability registry (`capabilities.test.ts`)
- Sticky session wiring (`sticky-session.test.ts`)

They follow the existing repo convention: `node:test` + `node:assert/strict`, no test framework dependency.
