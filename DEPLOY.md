# What goes where

## Into the GitHub repo (`Blue-Bonnet`, root)

| File | Notes |
|---|---|
| `index.html` | **The only file that changes what users see.** Repo root — that's where Pages serves from. |
| `BLUE-BONNET-HANDOFF.md` | Updated. Storage filter documented as off; the two paragraphs that contradicted that are gone. |
| `test-seam.mjs` | New, 17 checks. |
| `test-memory.mjs` | Unchanged from your copy, included so all three suites live together. |
| `test-episodes.mjs` | Unchanged from your copy. |
| `test-wiring.mjs` | New, 21 checks. Covers the kit path, failover, and the no-kit path. |
| `blue-bonnet-kit.js` | **Now wired in.** `index.html` loads it and routes the main chat through `BBKit.ask()`. |

Nothing loads the test files at runtime. They're in the repo so the next session finds them next to the code.

Commit message that says what happened:

```
brain: fix extraction regex, restore prompt caching, add seam tests
```

## Not into the repo

**`cloudflare-worker.js`** — paste into the Cloudflare dashboard, not GitHub. And note: this is the **`bluebonnetproxy`** worker (Adulting / the tools one), *not* the `blue-bonnet-app-proxy` that standalone Blue Bonnet uses. Standalone needs no worker change at all — its worker already passes an array system prompt straight through, which is why the caching split works untouched.

The patch wraps a string system prompt in a `cache_control` block. Without it, any app sending a plain string pays full price on a ~7k-token knowledge base every message. Standalone is unaffected either way; Adulting is not. Do it when you next touch Adulting.

**`test-integration.mjs`** — 6 checks on the kit in isolation. Optional; `test-wiring.mjs` covers the same ground against the real app.

## Running the tests

From a directory containing `index.html`:

```bash
npm install jsdom
node test-memory.mjs      # 24/24
node test-episodes.mjs    # 12/12
node test-seam.mjs        # 17/17
```

All three verified green against the exact files in this folder.

`test-seam.mjs` is the one that matters most going forward. The other two drive the memory modules directly through `window.__bb`, which is how a dead extraction path sat behind 36 passing tests. The seam suite is the only one that crosses from "the API replied" to "memory changed" — and it asserts on what `sendMessage` actually puts on the wire, not on what a helper returns in isolation.

## After deploying

Have four or five exchanges (extraction runs every 4th), then in the browser console:

```js
__bb.memory.openThreads      // should be non-empty — was always [] before the fix
__bb.systemBlocks('test')    // array of 2, cache_control on the first
```

Then check the Anthropic console over the next few days for cache-read tokens appearing on ordinary messages. If cost hasn't moved, investigate rather than assume.


## The kit is wired in

`index.html` now loads `blue-bonnet-kit.js` and sends the main chat through
`BBKit.ask()`. What that buys: automatic failover to the gateway when Anthropic
is out of credit, rate limited or down; error messages that name the real cause
instead of blaming the proxy URL; and status text during the call.

Both files must be uploaded together. The kit is loaded by a `<script src>` tag,
so it has to sit beside `index.html` in the repo root.

**If the kit is missing, the app still works.** `kitReady()` gates the whole
thing, and the original direct-fetch path is still there as the else branch.
A failed upload degrades to the old behaviour rather than a blank screen —
verified in `test-wiring.mjs`.

**The proxy is unchanged.** Still `blue-bonnet-app-proxy`, not the shared
`bluebonnetproxy` — keeping strangers' use of the standalone app off the other
apps' billing was deliberate and stays that way.

**One thing to know about failover.** When the gateway answers, your prompt —
including the memory block — goes to Groq or Gemini instead of Anthropic. With
the storage filter off, that means whatever is in memory travels there too. The
reply is prefixed with the backup notice so the person knows, and the gateway
is explicitly told it cannot perform actions. Worth a look at your gateway's
retention settings before this sees real traffic, since it's the one path where
this data reaches a provider that wasn't in the picture before.
