/* ===========================================================================
   BLUE BONNET KIT  v1.0
   Everything built for Blue Bonnet in Adulting, extracted so any app can use it.

   Drop this file in, call BBKit.configure(), and you get:

     1. GATEWAY CLIENT      — your Cloudflare gateway (Groq/Gemini), with
                              logging + feedback for building training data
     2. FAILOVER ROUTING    — Anthropic first (tools work), gateway when
                              Anthropic is out of credit / rate limited / down
     3. HONEST ERRORS       — says what actually broke instead of one
                              catch-all message that blames configuration
     4. ATTACHMENTS         — PDFs, CSVs, photos and screenshots into chat
     5. FEEDBACK UI         — quiet thumbs that turn usage into training data

   No framework, no build step, no dependencies. Works in any browser app.

   ---------------------------------------------------------------------------
   WHY IT'S SHAPED THIS WAY — lessons paid for in real debugging time:

   - Anthropic goes first because it's the only one that supports TOOLS. An
     assistant that can act is worth more than one that only talks, so the
     paid path is tried first and the free one catches the fall.

   - Failover covers "not configured" as well as "failed". A backup that only
     works when the primary is *configured but broken* leaves you dead in the
     water on a fresh install.

   - Every error names its real cause. A single message that said "set your
     Worker Proxy URL" for every failure once sent us chasing a config
     problem that didn't exist while the actual cause (an empty Anthropic
     balance) stayed hidden for an hour.

   - Tool traffic is summarised, not dropped, when falling back. The gateway
     speaks OpenAI format with no tool blocks, so those turns become readable
     text instead of vanishing mid-conversation.

   - PDFs are converted to text locally rather than sent as images. Cheaper,
     faster, and far more accurate.
   =========================================================================== */

const BBKit = (function () {
  "use strict";

  const cfg = {
    gatewayUrl: "https://blue-bonnet-gateway.dustin12342986.workers.dev",
    gatewayKey: "",            // your gateway key
    anthropicProxyUrl: "",     // your Cloudflare Worker in front of Anthropic
    app: "app",                // shows up in gateway logs
    session: "default",
    pdfJsUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfWorkerUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  };

  function configure(opts) {
    Object.keys(opts || {}).forEach((k) => { if (k in cfg) cfg[k] = opts[k]; });
    return status();
  }

  function gatewayReady() {
    return !!cfg.gatewayKey && cfg.gatewayKey !== "PUT_YOUR_GATEWAY_KEY_HERE";
  }
  function anthropicReady() {
    return /^https?:\/\//.test(String(cfg.anthropicProxyUrl || ""));
  }

  /* One call to answer "why isn't this working?" without guesswork. */
  function status() {
    return {
      anthropicProxyUrl: cfg.anthropicProxyUrl,
      anthropicReady: anthropicReady(),
      gatewayUrl: cfg.gatewayUrl,
      gatewayReady: gatewayReady(),
      usable: anthropicReady() || gatewayReady(),
      app: cfg.app,
    };
  }

  /* ---------------------------------------------------------------------
     1. Gateway client
     --------------------------------------------------------------------- */
  let lastInteractionId = null;

  async function gatewayAsk(messages, opts) {
    opts = opts || {};
    if (!gatewayReady()) throw new Error("gateway key not set");
    const res = await fetch(cfg.gatewayUrl + "/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + cfg.gatewayKey,
        "x-app": cfg.app,
        "x-session": opts.session || cfg.session,
      },
      body: JSON.stringify({
        messages,
        tier: opts.tier || "balanced",
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        max_tokens: opts.maxTokens != null ? opts.maxTokens : 1024,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error && data.error.message) || "gateway error");
    lastInteractionId = (data.bb && data.bb.interaction_id) || null;
    return {
      text: (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "",
      interactionId: lastInteractionId,
      provider: (data.bb && data.bb.provider) || "gateway",
    };
  }

  /* Ratings are what turn ordinary use into training data. Best-effort by
     design — feedback must never block or break the chat. */
  async function rate(rating, note, interactionId) {
    const id = interactionId || lastInteractionId;
    if (!id || !gatewayReady()) return false;
    try {
      await fetch(cfg.gatewayUrl + "/v1/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + cfg.gatewayKey },
        body: JSON.stringify({ interaction_id: id, rating, note: note || null }),
      });
      return true;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------------
     2. Anthropic call + failover routing
     --------------------------------------------------------------------- */
  async function anthropicCall(body) {
    const res = await fetch(cfg.anthropicProxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      const err = new Error("anthropic " + res.status + (t ? ": " + t.slice(0, 300) : ""));
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    if (data && data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data;
  }

  /* Anthropic messages carry tool_use / tool_result / image blocks. The
     gateway takes plain strings, so flatten rather than drop — a conversation
     that silently loses its middle makes no sense to the next model. */
  /* The system prompt may arrive as a plain string OR as Anthropic content
     blocks. Blocks are how prompt caching is expressed: a stable prefix
     marked cache_control, with volatile per-message content appended after
     it so it can't invalidate the cached part.

     Anthropic takes either shape, so the primary path never noticed. The
     fallback path did `system + "..."`, and concatenating an array onto a
     string gives "[object Object],[object Object]" — which meant that on
     every failover the assistant lost its identity, its knowledge base and
     its hard boundary, and answered as a generic model. Flatten first. */
  function systemToText(system) {
    if (typeof system === "string") return system;
    if (Array.isArray(system)) {
      return system
        .map((b) => (b && typeof b === "object" ? (b.text || "") : String(b || "")))
        .filter(Boolean)
        .join("\n\n");
    }
    return system ? String(system) : "";
  }

  function toPlainMessages(system, messages) {
    const out = [{ role: "system", content: systemToText(system) }];
    (messages || []).forEach((m) => {
      if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); return; }
      const parts = (m.content || []).map((b) => {
        if (b.type === "text") return b.text;
        if (b.type === "tool_use") return "[asked the app to " + b.name + "]";
        if (b.type === "tool_result") return "[app replied: " + String(b.content).slice(0, 300) + "]";
        if (b.type === "image") return "[image attached — not available on this provider]";
        return "";
      }).filter(Boolean);
      if (parts.length) out.push({ role: m.role, content: parts.join("\n") });
    });
    return out;
  }

  /* The main entry point.

     Runs the Anthropic tool-use loop; on ANY failure re-asks the gateway.
     Returns { text, usedBackup, backupReason, interactionId, actions }.
     `actions` lists what tools actually ran, so the UI can show receipts. */
  async function ask(opts) {
    const system = opts.system || "";
    const messages = opts.messages || [];
    const tools = opts.tools || null;
    const handlers = opts.handlers || {};
    const maxRounds = opts.maxRounds || 4;
    const onStatus = opts.onStatus || function () {};

    if (!anthropicReady() && !gatewayReady()) {
      throw new Error("No assistant endpoint configured. Set anthropicProxyUrl, gatewayKey, or both.");
    }

    const actions = [];
    let finalText = "";

    for (let round = 0; round < maxRounds; round++) {
      let data;
      try {
        if (!anthropicReady()) throw new Error("no anthropic proxy configured");
        data = await anthropicCall(Object.assign(
          { max_tokens: opts.maxTokens || 1024, system: system, messages: messages },
          opts.model ? { model: opts.model } : {},
          tools ? { tools: tools } : {}
        ));
      } catch (primaryErr) {
        if (!gatewayReady()) throw primaryErr;
        onStatus("brain building mode");
        const reason = anthropicReady() ? "failed" : "unconfigured";
        const g = await gatewayAsk(
          toPlainMessages(systemToText(system) +
            "\n\nIMPORTANT: on this provider you cannot perform actions in the app. " +
            "Answer directly, and if something needs doing, say where to do it. " +
            "Never claim to have done anything.", messages),
          { session: opts.session, tier: opts.tier, maxTokens: opts.maxTokens }
        );
        return {
          text: g.text, usedBackup: true, backupReason: reason,
          interactionId: g.interactionId, provider: g.provider, actions: actions,
          primaryError: String(primaryErr.message || primaryErr),
        };
      }

      const blocks = data.content || [];
      messages.push({ role: "assistant", content: blocks });

      const textNow = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      if (textNow) finalText = textNow;

      const toolBlocks = blocks.filter((b) => b.type === "tool_use");
      if (!toolBlocks.length) break;

      onStatus("doing that now");
      const results = [];
      for (const tb of toolBlocks) {
        let result;
        try {
          const fn = handlers[tb.name];
          result = fn ? await fn(tb.input || {}) : { ok: false, message: "Unknown tool: " + tb.name };
        } catch (e) {
          result = { ok: false, message: "That failed: " + (e.message || e) };
        }
        actions.push({ tool: tb.name, ok: !!result.ok, message: result.message || "" });
        results.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: results });
    }

    return {
      text: finalText, usedBackup: false, backupReason: "",
      interactionId: null, provider: "anthropic", actions: actions,
    };
  }

  /* ---------------------------------------------------------------------
     3. Honest error messages
     --------------------------------------------------------------------- */
  function explainError(err) {
    const msg = String((err && err.message) || err || "");
    let human;
    if (/no assistant endpoint/i.test(msg)) {
      human = "No assistant endpoint is configured yet.";
    } else if (/\b401\b|\b403\b|invalid.*api.*key|authentication/i.test(msg)) {
      human = "The proxy answered, but the API key was rejected. Check the key in your Worker's settings.";
    } else if (/\b402\b|credit|billing|quota|insufficient/i.test(msg)) {
      human = "Out of API credit. Top up, or configure the gateway so it can fall back to free providers.";
    } else if (/\b429\b|rate.?limit/i.test(msg)) {
      human = "Rate limited — too many requests just now. Wait a minute and try again.";
    } else if (/\b5\d\d\b/.test(msg)) {
      human = "The proxy returned a server error. Check its logs.";
    } else if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      human = "Couldn't reach the proxy at all — network issue, wrong URL, or not deployed.";
    } else {
      human = "The assistant call failed.";
    }
    return { message: human, details: msg.slice(0, 300) };
  }

  /* ---------------------------------------------------------------------
     4. Attachments
     --------------------------------------------------------------------- */
  let pdfLoading = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLoading) return pdfLoading;
    pdfLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = cfg.pdfJsUrl;
      s.onload = () => {
        if (!window.pdfjsLib) return reject(new Error("PDF reader failed to load."));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = cfg.pdfWorkerUrl;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error("Couldn't load the PDF reader."));
      document.head.appendChild(s);
    });
    return pdfLoading;
  }

  /* pdf.js returns loose fragments with coordinates, not lines. Printing them
     in order gives one run-on string that no pattern can read. Group by Y
     (with tolerance — characters on a line rarely share an exact Y), sort
     each group left to right, and the original rows come back. */
  async function pdfToText(arrayBuffer) {
    const pdfjsLib = await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map();
      content.items.forEach((item) => {
        if (!item.str || !item.str.trim()) return;
        const key = Math.round(Math.round(item.transform[5]) / 3);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push({ x: item.transform[4], str: item.str });
      });
      Array.from(rows.keys()).sort((a, b) => b - a).forEach((k) => {
        const line = rows.get(k).sort((a, b) => a.x - b.x).map((i) => i.str)
          .join(" ").replace(/\s+/g, " ").trim();
        if (line) lines.push(line);
      });
    }
    return lines.join("\n");
  }

  /* Returns { kind:"text"|"image", name, text?, media?, data? }.
     PDFs become text (cheaper and more accurate than vision); photos and
     screenshots stay images so the model can actually look at them. */
  async function readAttachment(file) {
    const isImage = /^image\//.test(file.type);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";

    if (isImage) {
      if (file.size > 4 * 1024 * 1024) throw new Error("Image over 4MB — try a smaller one or a screenshot.");
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      return { kind: "image", name: file.name, media: file.type, data };
    }
    if (isPdf) {
      const text = await pdfToText(await file.arrayBuffer());
      if (!text.trim()) throw new Error("That PDF has no readable text — it's probably a scan. Attach it as an image instead.");
      return { kind: "text", name: file.name, text };
    }
    return { kind: "text", name: file.name, text: await file.text() };
  }

  /* Turn attachments + a question into one Anthropic-shaped user message. */
  function attachmentsToContent(attachments, text) {
    if (!attachments || !attachments.length) return text;
    const content = [];
    attachments.forEach((a) => {
      if (a.kind === "image") {
        content.push({ type: "image", source: { type: "base64", media_type: a.media, data: a.data } });
      } else {
        content.push({ type: "text", text: "Attached file: " + a.name + "\n-----\n" + String(a.text).slice(0, 60000) + "\n-----" });
      }
    });
    content.push({ type: "text", text: text || "Read this and do whatever belongs in the app." });
    return content;
  }

  /* ---------------------------------------------------------------------
     5. Feedback UI
     --------------------------------------------------------------------- */
  /* Deliberately tiny and grey until pressed. No prompting, no nagging —
     it should be completely ignorable. Ratings without a gateway id are kept
     locally so they aren't simply discarded. */
  function attachFeedback(el, interactionId, onLocal) {
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:6px;margin-top:4px;opacity:0.35;font-size:12px";
    bar.onmouseenter = () => { bar.style.opacity = "0.8"; };
    bar.onmouseleave = () => { if (!bar.dataset.rated) bar.style.opacity = "0.35"; };

    const mk = (glyph, value, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = glyph;
      b.title = title;
      b.style.cssText = "background:none;border:none;cursor:pointer;padding:2px 4px;font-size:12px;line-height:1;color:inherit";
      b.onclick = () => {
        if (bar.dataset.rated) return;
        bar.dataset.rated = "1";
        bar.style.opacity = "1";
        bar.style.fontSize = "11px";
        bar.textContent = value > 0 ? "thanks — noted" : "noted, I'll do better";
        if (interactionId) rate(value, null, interactionId);
        else if (typeof onLocal === "function") onLocal(value);
      };
      return b;
    };
    bar.appendChild(mk("👍", 1, "This helped"));
    bar.appendChild(mk("👎", -1, "This missed"));
    el.appendChild(bar);
    return bar;
  }

  /* Standard wording so every app describes the fallback the same way. */
  const BACKUP_NOTICE =
    "🧠 Brain building mode — running on your own gateway, which is what trains it over time. " +
    "I can talk things through, but I can't change anything in the app from here.";

  return {
    configure, status,
    ask, gatewayAsk, anthropicCall, rate,
    toPlainMessages, explainError,
    readAttachment, attachmentsToContent, pdfToText,
    attachFeedback, BACKUP_NOTICE, systemToText,
    _cfg: cfg,
  };
})();

if (typeof module !== "undefined") module.exports = BBKit;
