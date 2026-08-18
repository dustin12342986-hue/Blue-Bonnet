/**
 * Blue Bonnet Gateway — the backup that answers when Anthropic can't.
 *
 * Paste over your existing blue-bonnet-gateway Worker (Cloudflare dashboard
 * → Workers & Pages → blue-bonnet-gateway → Edit code) and Deploy.
 *
 * WHY YOU'RE REPLACING IT: the old one answered "all providers failed",
 * which says nothing about which provider failed or why. This one names the
 * provider, the HTTP status and the upstream message, so a dead API key or a
 * retired model takes seconds to spot instead of an evening.
 *
 * SECRETS to set (Settings → Variables and Secrets → Add):
 *   GATEWAY_KEY   - must equal the gatewayKey in index.html
 *   GROQ_API_KEY  - from console.groq.com  (optional, but you want one of these)
 *   GEMINI_API_KEY- from aistudio.google.com/apikey
 *
 * OPTIONAL plain variables, to change model without editing code:
 *   GROQ_MODEL    - default below
 *   GEMINI_MODEL  - default below
 *
 * Hit https://blue-bonnet-gateway.<you>.workers.dev/v1/health in a browser
 * to see which keys are actually set. It never prints the keys themselves.
 */

const ALLOWED_ORIGIN = "https://dustin12342986-hue.github.io";

// Providers get retired without much warning — Groq in particular has
// decommissioned model names more than once. If a provider starts failing
// with "model not found", set GROQ_MODEL / GEMINI_MODEL as a Worker variable
// rather than editing this file.
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    if (url.pathname === "/v1/health") {
      return json({
        ok: true,
        gateway_key_set: !!env.GATEWAY_KEY,
        groq_key_set: !!env.GROQ_API_KEY,
        gemini_key_set: !!env.GEMINI_API_KEY,
        groq_model: env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
        gemini_model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
        note: "If a key shows false, that provider cannot be tried at all.",
      }, 200);
    }

    // Ratings are best-effort and must never break a working chat.
    if (url.pathname === "/v1/feedback") {
      return json({ ok: true }, 200);
    }

    if (url.pathname !== "/v1/chat/completions") {
      return json({ error: { message: "Not found: " + url.pathname } }, 404);
    }
    if (request.method !== "POST") {
      return json({ error: { message: "Method not allowed" } }, 405);
    }

    const auth = request.headers.get("authorization") || "";
    const key = auth.replace(/^Bearer\s+/i, "").trim();
    if (!env.GATEWAY_KEY) {
      return json({ error: { message: "Gateway is missing its GATEWAY_KEY secret." } }, 500);
    }
    if (key !== env.GATEWAY_KEY) {
      return json({ error: { message: "Gateway key does not match. Check gatewayKey in index.html." } }, 401);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: { message: "Invalid JSON body" } }, 400); }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      return json({ error: { message: "No messages sent" } }, 400);
    }
    const maxTokens = body.max_tokens || 1024;
    const temperature = body.temperature != null ? body.temperature : 0.7;

    // Try each provider in turn. Collect the real reason each one failed so
    // the reply can say what actually went wrong.
    const tried = [];

    // Streaming. The gateway is the primary path now, so it has to stream or
    // every reply is a silent wait again. Groq speaks OpenAI SSE, which we
    // hand straight back rather than buffering. Gemini has a different shape
    // and stays non-streaming — if Groq is down, a slower answer beats none.
    if (body.stream === true && env.GROQ_API_KEY) {
      const gs = await tryGroqStream(env, messages, maxTokens, temperature);
      if (gs.ok) {
        return new Response(gs.body, {
          status: 200,
          headers: { ...cors(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }
      tried.push("groq(stream): " + gs.why);
    }

    if (env.GROQ_API_KEY) {
      const r = await tryGroq(env, messages, maxTokens, temperature);
      if (r.ok) return json(reply(r.text, "groq"), 200);
      tried.push("groq: " + r.why);
    } else {
      tried.push("groq: no GROQ_API_KEY set");
    }

    if (env.GEMINI_API_KEY) {
      const r = await tryGemini(env, messages, maxTokens, temperature);
      if (r.ok) return json(reply(r.text, "gemini"), 200);
      tried.push("gemini: " + r.why);
    } else {
      tried.push("gemini: no GEMINI_API_KEY set");
    }

    return json({ error: { message: "Backup providers all failed \u2014 " + tried.join(" | ") } }, 502);
  },
};

function reply(text, provider) {
  return {
    choices: [{ message: { role: "assistant", content: text } }],
    bb: { provider: provider, interaction_id: "g_" + Date.now().toString(36) },
  };
}

async function tryGroqStream(env, messages, maxTokens, temperature) {
  const model = env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.GROQ_API_KEY,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: true }),
    });
    if (!res.ok) {
      let why = String(res.status);
      try { why += " " + msgOf(await res.json()); } catch (e) {}
      return { ok: false, why: why + " (model " + model + ")" };
    }
    if (!res.body) return { ok: false, why: "no stream body (model " + model + ")" };
    return { ok: true, body: res.body };
  } catch (e) {
    return { ok: false, why: "network: " + (e.message || String(e)) };
  }
}

async function tryGroq(env, messages, maxTokens, temperature) {
  const model = env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.GROQ_API_KEY,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, why: res.status + " " + msgOf(data) + " (model " + model + ")" };
    }
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return { ok: false, why: "empty reply (model " + model + ")" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, why: "network: " + (e.message || String(e)) };
  }
}

// Gemini speaks its own shape, so the OpenAI-style messages have to be
// translated: the system turn becomes systemInstruction, and assistant
// becomes "model".
async function tryGemini(env, messages, maxTokens, temperature) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  try {
    const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content || "") }],
      }));

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, why: res.status + " " + msgOf(data) + " (model " + model + ")" };
    }
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts &&
      cand.content.parts.map((p) => p.text || "").join("");
    if (!text) return { ok: false, why: "empty reply (model " + model + ")" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, why: "network: " + (e.message || String(e)) };
  }
}

function msgOf(data) {
  if (!data) return "no body";
  if (data.error && data.error.message) return data.error.message;
  if (typeof data.error === "string") return data.error;
  return JSON.stringify(data).slice(0, 160);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-app, x-session",
  };
}
