# Persistent increment vs d9c8e9c (PR10 / run33 baseline)

## Relationship

| Artifact | Value |
| --- | --- |
| baseline (PR10) | `d9c8e9c425e46c3a8c67245646c243e6fb27a04c` |
| parent | `109ba13dff17ed7b9db58b7eb84d67f4c249b458` |
| prior run33 preload tar | `f23a2b957c1804dfdf38d46c7b6d8132a55cd1e18416b587e8cfb062d2932341` |
| prior run32 tar | `56501a915bf6cd114f2eb17e5dbec681e71dd36ebd5844d7bdcdcfe7aa80992d` |
| prior run31 tar | `cd047e7e1326e4ca7e96870c33eb3b4c15fddf1bc8ea20b2d99e99c51d7c0c4d` |

## Goal

Execute the **actual** production return value passed to `defineAgent` in
`agent/agent/agent.ts` with empty `HAMSTER_MODEL_ID`, observing
`hamster-scripted` / `hamster-fixture` from **this file’s** `fixtureSelection`.

## Readonly eve@1.0.2 findings

- `defineAgent`: pure brand stamp; returns same object; no listen/start.
- `mockModel`: in-memory `MockLanguageModelV4`; no listen on construct.
- Direct `import agent.ts` under Node strip-types failed with
  `ERR_MODULE_NOT_FOUND` for `../lib/liveSelection.js` (authored `.js`
  specifier; eve bundler remaps, Node does not).

## Tests-only seam (no selection semantic change)

- `authoredTsResolve.loader.mjs` + `authoredTsResolve.preload.ts`: remap local
  authored `.js` → `.ts` when `.js` absent.
- Chained **after** official `networkDeny.preload.ts` in npm `test`.
- New regression: `lib/agent.fixtureWiring.entry.test.ts` imports production
  `agent/agent/agent.ts` and asserts the branded default export.

Production `agent.ts` / `liveSelection.ts` selection logic **unchanged**.
