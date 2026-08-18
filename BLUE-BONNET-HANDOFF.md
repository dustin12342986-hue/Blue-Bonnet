# Blue Bonnet — Handoff

Give this to a new chat along with `index.html` and `blue-bonnet-app-worker.js`.
It's written so you can pick up exactly where we left off without re-explaining
anything.

---

## What Blue Bonnet is

An AI assistant built specifically for neurodivergent users — ADHD, dyslexic,
autistic. It exists as a **standalone web app** and as an **embedded assistant**
inside a family of sibling apps.

It runs on Claude via the Anthropic API, but it is its own product: its own
identity, knowledge base, boundaries, memory, and interaction design.

**Founding premise:** general assistants are trained on data that skews
neurotypical. They give confident, well-formed answers that don't account for how
these brains handle instructions, motivation, overwhelm and follow-through.
Closing that gap is the entire point.

**Live at:** https://dustin12342986-hue.github.io/Blue-Bonnet/
**Repo:** https://github.com/dustin12342986-hue/Blue-Bonnet

---

## Files

| File | Where it goes |
|---|---|
| `index.html` | GitHub Pages repo root (`Blue-Bonnet`) |
| `blue-bonnet-app-worker.js` | Pasted into the Cloudflare Worker → Deploy |
| `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` | Repo root (PWA) |

Single self-contained HTML file. **No build step, no framework, no bundler** —
this is a hard architectural preference, not an accident. Don't introduce one.

---

## Infrastructure (already set up and working)

- **Cloudflare Worker:** `blue-bonnet-app-proxy.dustin12342986.workers.dev`
  Holds the Anthropic API key as an encrypted secret named exactly
  `ANTHROPIC_API_KEY`. Never put a key in the HTML.
- **Google OAuth Client ID:** `120969532939-mtu9qkjnfrfdemiq5otu2n4g44bpohvb.apps.googleusercontent.com`
  Scope is `drive.appdata` **only** — its own hidden folder, no access to real
  Drive files.
- **Model:** `claude-sonnet-5`
- **Prompt caching is ON** in the worker. The system prompt is ~7k tokens and
  near-identical every call, so it's marked `cache_control: ephemeral`. Repeat
  reads bill at ~10%. Output is unchanged — purely a billing optimisation.

### Cost history (important context)
Two users were costing **~$30/month**. Causes found: the full system prompt sent
uncached on every message, plus a **second API call per exchange** for memory
extraction. Fixes applied: prompt caching, and memory extraction batched to
every 4th exchange (with a `pagehide` save so nothing is lost on tab close).
Expected to land around $3–5/month.

**Deliberately NOT done:** routing to Haiku. It's the obvious next saving, but
it's measurably weaker at nuanced reasoning, which is precisely what this product
exists to do well. Don't do it without a real conversation about the tradeoff.

---

## Core design principles

1. **Break things down by default.** Short replies, one concrete next action. A
   wall of text is itself a barrier — it causes the exact overwhelm it's meant to
   relieve. Offer more; never dump it.
2. **Design for follow-through, not information delivery.** Momentum matters as
   much as accuracy. Never guilt, never nag.
3. **Explain multiple ways.** If something isn't landing, reframe it rather than
   repeating it louder or longer.
4. **Name what's general vs. adapted.** Say plainly whether framing is a general
   pattern or something specific to ADHD/autistic thinking. Never dress up
   general-population psychology as personalised insight.

## THE HARD BOUNDARY — do not weaken this

Blue Bonnet **never** hands down a directive verdict about someone's
relationships or mental health ("you should take a break", "you should leave",
"you should confront them"). It reflects, asks questions, helps the person think
— it does not decide for them.

**More personal context does NOT earn more directive licence.** If anything it
demands more caution. It should be willing to say plainly: *"This isn't something
I should be deciding for you."*

This exists because directive relationship advice from a general assistant
**caused real harm**. It is enforced in the system prompt, and in the sibling
apps it's asserted by automated tests. Never soften or remove it.

It also never diagnoses, and points to real human support for genuine crisis
rather than trying to be the whole answer.

---

## Knowledge base (~26k characters, in `KNOWLEDGE_BASE`)

**Executive function** — Barkley's model (ADHD as a self-regulation disorder, not
an attention one); the knowing-doing gap; time blindness ("the future is never as
compelling as the now"); delayed cortical maturation (Shaw et al. 2007); DESR as
core rather than incidental.

**Emotion & motivation** — Dodson's Rejection Sensitive Dysphoria, correctly
flagged as a *described pattern, not a DSM diagnosis*, understood as brain-based
rather than trauma-caused; the interest-based nervous system and why "just
prioritise" structurally fails.

**Autism** — monotropism (Murray, Lesser & Lawson); masking/camouflaging with its
measurable biological cost and link to delayed diagnosis especially in women;
autistic burnout per the Higgins et al. (2021) consensus definition; AuDHD's
genuinely contradictory needs.

**Real-time dysregulation** — meltdown vs. shutdown vs. freeze as distinct
states. Key counterintuitive point: **closing the distance during a shutdown
reads as MORE demand**. Capacity is what's available *that day*, not in theory.

**Organizing methodology** — GTD, KonMari, Dana K. White's Container Concept,
FlyLady, Kolberg & Nadeau ("visibility trumps accessibility", "the pile is the
file", landing strips).

Every claim was web-researched for accurate attribution, not written from memory.

---

## Features built

**Onboarding calibration** — three questions on first use: how to deliver hard
things, whether lists help or overwhelm, and how their brain works
(ADHD / autistic / AuDHD / prefer not to say). Answers directly modify the system
prompt. Someone who says "lists overwhelm me" genuinely stops getting bullets.
Skippable.

**Compress late, not early (episode tier).** Memory is now two-tiered:

- **Recent conversation is kept RAW**, verbatim, timestamped, speaker-labelled
  (~600KB / 400 episodes). Reflection reads *this*, not summaries.
- **Only on eviction** is an episode distilled into harmonic notes — compression
  at the last possible moment rather than the first.

The reasoning: the old design summarised every exchange immediately and threw the
original away, then hunted for patterns in the summaries. That's compression
stacked on compression, and the detail that makes an insight good is usually
exactly what the first pass discarded — a summariser can't know in advance what
will matter in three weeks. Tested by `test-episodes.mjs` (12 checks).

**No storage-side content filter — deliberate.**
Blue Bonnet stores and reasons over whatever comes up, including relationships
and mental health. There is no keyword filter on memory and no instruction in
the extraction or reflection prompts refusing those subjects. This is a
considered decision by Dusty, not an oversight: an assistant that has to look
away from a third of someone's life can't understand the rest of it either.

**The behavioural hard boundary is separate and fully in force.** Blue Bonnet
still never hands down directive verdicts about anyone's relationships or
mental health, and still never diagnoses. The distinction is between what it
may *know and reason about* (everything) and what it may *say* (no verdicts).
Those are two different mechanisms; changing one does not change the other.
See "Things NOT to change without discussion" — the behavioural boundary is
still on that list.

**Harmonic memory** — facts aren't strings in a list, they're notes with an
amplitude:
- **Decay** — amplitude falls with time (21-day base half-life). Something said
  once months ago doesn't weigh the same as something raised Tuesday.
- **Reinforcement** — re-hearing something lifts it and *lengthens its
  half-life*, so repetition consolidates. One-offs fade on their own.
- **Resonance** — facts observed together get linked; reinforcing one lifts its
  partners (sympathetic vibration). A cluster that keeps ringing together is what
  an insight is made of.
- Pruning is by amplitude, **not** by count — nothing is capped at "last 30".
- Context is amplitude-weighted and labelled (`recurring` / `familiar` / `faint`)
  so the model knows what to act on versus mention lightly.
- Migrates v1 string facts automatically.

**Reflection & insights** — at most once a day, and only when clusters are
genuinely resonating, a separate call consolidates them into *hypotheses*. These
are surfaced in the system prompt explicitly as things to hold loosely, never as
verdicts. **Every insight is visible and removable** in the gear panel ("What I
think I've noticed"). Dismissed insights are flagged rather than deleted so the
reflection prompt won't propose them again. Reflection may reason about anything
in the conversation; what it may not produce is a judgement of the person or a
diagnosis. The panel is the control that makes this safe to do — inference the
person can't see or correct is the wrong shape for this product, so every
hypothesis is shown and one tap removes it.

Tested by `test-memory.mjs` (24 checks) — decay curves, resonance lifting and
pruning thresholds are easy to get subtly wrong and impossible to eyeball. A
`window.__bb` read-only test hook exposes the internals; it changes no runtime
behaviour.

**Legacy note — persistent memory** — extracts durable facts and open threads across
conversations, tracks how long a thread has been open, can gently check in
(explicitly instructed never with guilt). No subject is excluded from memory;
see the note on the storage filter above.

**Google Drive sync** — local-first (`localStorage` stays source of truth for
speed), Drive as a background mirror. Newest-write-wins via `lastVisit`. Debounced
4s push, pull on sign-in, first-run seeds Drive from local, retries on `online`.
Fully degrades to local-only if not signed in or offline.

**Voice** — tap-to-listen on every reply; mic input; **continuous conversation
mode** (speaks each reply then auto-listens again). Mobile fixes applied: silent-
utterance unlock on first tap, mic release delay before speaking, `resume()`
keep-alive for Chrome's ~15s auto-pause.

**Voice picker** — ranks the device's built-in voices by how natural they
actually sound (boosts Neural/Natural/Enhanced/Siri, buries Zarvox/Trinoids/Fred),
tap any to hear a sample, plus a 0.6–1.4× speed slider. Both persist.

**Attachments** — photos and PDFs, 4MB cap, preview chip before sending,
thumbnail in the transcript. Instructed to break dense documents (bill, form,
letter) down to what matters and the next action.

**Three themes** in the gear panel — Light, Dark, and **Calm**. Calm strips all
saturation for when colour itself is too much; urgency is carried by weight and
an uppercase label instead of colour, so alerts stay legible without adding
stimulation. Honours `prefers-reduced-motion` throughout.

**PWA** — installable. Service worker registration deliberately runs **first** in
the script, before anything else can throw, because a later failure silently
kills installability.

**Overlay guard** — browser extensions (e.g. Thunderbit) inject invisible
full-screen overlays at max z-index that swallow every click. A runtime guard
neutralises any large fixed overlay that isn't Blue Bonnet's own. This was a real
bug that made the whole UI appear dead.

---

## Visual identity

**Two colours only.** Petal blue for brand (buttons, user messages, focus), amber
**exclusively** for needs-attention. Everything else is neutral. Backgrounds and
text spend no hue budget.

- Light: `--accent: #2E3C87`
- Dark: `--accent: #8B9AE8` (same colour, lightened for contrast)
- Calm: fully desaturated

`--accent-ink` handles readable text on the accent in each theme.

**On the colour choice:** dusty blue was rejected as too close to Gemini's azure.
Deep petal violet-blue was chosen because it's defensible — it's the actual
flower, not an arbitrary pick. A sage/botanical direction was explored and
dropped because it required a third colour.

**Icon:** a white bluebonnet on the teal→blue→violet→pink→orange gradient.
Worth knowing: **five attempts read as a Christmas tree.** A tapering stack of
white blobs on a vertical stem always does. What fixed it was **tilting the bloom
~10° on a curved stem** — trees stand straight, flowers lean. Don't "fix" it back
to upright.

---

## The ecosystem

Blue Bonnet appears across several apps with **strictly isolated knowledge** —
Campus knows nothing about broadcast production, Adulting nothing about
photography:

- **Blue Bonnet** (standalone) — this app
- **Remembering** — ADHD working memory *(has its own handoff doc, 65 tests)*
- **Adulting / Organize It** — household ops
- **Campus** — college student life
- **The Screening Room** — photo/video critique
- **ADV Media Teams** — broadcast crew ops (the commercial one)
- **Businessing** — business tasks *(same architecture)*
- **Eternal Sunshine** — long-term goal planning *(same architecture)*

**Planned, not built:** ADV Media Discover, Bid Pilot, Project Manager, Batch,
Client Portal. When those arrive, the two clusters
(Screening Room ↔ Batch ↔ Client Portal, and ADV Media Teams ↔ Discover ↔ Bid
Pilot ↔ Project Manager) should share a data layer so Blue Bonnet can reason
across a real pipeline.

**Open question, deliberately unanswered:** whether Adulting and standalone Blue
Bonnet should share memory. Dusty raised it, then chose to think about it. It
reverses an earlier isolation decision, so don't implement it unprompted.

---

## Working style (matters)

- **Be direct.** Lead with the answer or the file. Verbose, hedged, roundabout
  answers are actively unhelpful here.
- **Verify, don't assume.** Render the page and check, run the tests, look at the
  output. Several real bugs this session were caught only by actually looking —
  and several were caused by assuming.
- **Say when something can't be done**, and why, rather than trying five
  workarounds silently.
- Deploy loop is: hand over the file → uploaded to GitHub → hard-reload. Mobile
  caches hard; a fresh `?v=N` or fully closing the tab is often needed.

---

## Known open items

1. **Cost verification** — check the Anthropic console. Expected ~$30 → ~$3–5.
   If it hasn't moved, investigate rather than guessing.
2. **PWA install on mobile** — desktop installs fine. Mobile Chrome wasn't
   offering it. Manifest, both icons and `sw.js` were all verified live and valid,
   and SW registration was moved to run first. If it still doesn't offer, the
   definitive answer is Chrome DevTools → Application → Manifest on the device
   (`chrome://inspect` over USB), which prints the exact reason.
3. **Google OAuth consent screen** may still be in *Testing* mode — publish it, or
   only listed test users can sign in.
4. **Shared memory between apps** — see open question above.

---

## Things NOT to change without discussion

- The hard boundary on relationship/mental-health verdicts
- Two-colour discipline (petal blue + amber only)
- The single-file, no-build-step architecture
- Sonnet as the model (see the Haiku note above)
- `drive.appdata` scope only — never broader Drive access
- Memory's exclusion of relationship conflicts and mental-health crises
- The tilted bluebonnet icon


---

## Regressions repaired (and how they got in)

This file was rebuilt from the *original* `index.html` rather than the patched
one, so three earlier fixes were lost. All three are back.

**1. The memory extraction regex was double-escaped again.**

```js
raw.match(/\\{[\\s\\S]*\\}/)   // matches a literal backslash — never fires
raw.match(/\{[\s\S]*\}/)     // fixed
```

The parse returned early every time, so `observeFacts(parsed.facts)` and the
whole `openThreads` block below it were unreachable. Effects: every 4th exchange
billed an extraction call that wrote nothing; `openThreads` could never populate,
so the check-in feature was inert; and harmonic memory was fed only by
`distillEpisode` on eviction — meaning the direct feed was severed and notes
only appeared on compression, which is the exact "compress early" behaviour the
episode tier was built to invert.

Note the new reflection parser at `maybeReflect` used the *correct* regex. Only
the older extraction path was affected.

**2. Prompt caching was gone.** The system prompt was one string with
`${buildMemoryContext()}` concatenated on the end, and `blue-bonnet-app-proxy`
wraps a string in a single `cache_control` block. Every memory change therefore
invalidated the whole ~7k-token knowledge base — and with episodes, notes and
insights now landing in that tail, it moves more often than it used to, not
less. Restored to two blocks: cached prefix, uncached memory. The Worker passes
arrays through untouched, so it needs no change.

**3. The knowledge-graph brain is not in this build.** Harmonic memory and the
graph solve overlapping problems and running both would be wrong, so this is
recorded as a decision rather than reintroduced.

### `test-seam.mjs` — 17 checks

`test-memory.mjs` and `test-episodes.mjs` drive the memory modules directly
through `window.__bb`. That is how a dead extraction path sat behind 36 passing
tests: nothing crossed the boundary between "the API replied" and "memory
changed". The seam suite only tests that crossing — a stubbed proxy returns a
realistic extraction reply and the suite asserts facts and threads actually
land, that the three JSON shapes the model really emits all parse, and that
what `sendMessage` puts **on the wire** is a two-block array carrying
`cache_control`.

Verified by reverting both fixes in a scratch copy: the suite fails 6 checks.
That last group matters — an earlier draft asserted on `systemBlocks()` in
isolation and passed against a build where `sendMessage` had been changed back
to string concatenation. Testing the helper instead of the wire is the same
blind spot that let the original bug through.

`window.__bb` now also exposes `updateMemoryFromConversation`, `systemBlocks`,
`pushMessage` and `clearMessages`. Still read-only handles; no runtime change.
