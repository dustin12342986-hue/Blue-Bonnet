/* ===========================================================
   BLUE BONNET (standalone app) — Cloudflare Worker proxy
   Dedicated to the standalone Blue Bonnet product specifically — kept
   separate from the other apps' workers so usage/cost from strangers
   using Blue Bonnet directly never mixes with your other apps' billing.

   SETUP:
   1. Go to https://dash.cloudflare.com -> Compute (Workers & Pages)
      -> Create -> Create Worker
   2. Name it "blue-bonnet-app-proxy" -> Deploy
   3. Click "Edit code", delete the placeholder, paste this whole file
      in, click "Deploy"
   4. Settings -> Variables and Secrets -> Add -> name: ANTHROPIC_API_KEY,
      value: (your key from console.anthropic.com) -> Encrypt -> Save
   5. Copy the worker's URL and paste it into PROXY_URL in blue-bonnet-app.html
   6. Update ALLOWED_ORIGIN below to wherever you host the standalone app
   =========================================================== */

const ALLOWED_ORIGIN = "https://dustin12342986-hue.github.io";

// Since this proxy is reachable by anyone who uses the app (not just you),
// clamp max_tokens server-side regardless of what the client requests —
// caps worst-case cost per message even if someone tampers with requests.
const MAX_TOKENS_CAP = 1200;

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not set on this worker" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const body = await request.json();
      const requestedTokens = Number(body.max_tokens) || 1000;

      // Streaming. Without it the client waits for the entire reply before
      // showing a single word, which is why a normal answer felt like 15
      // seconds — the model was not slow, the UI was silent. When the app
      // asks for a stream we hand the upstream body straight back rather
      // than buffering it here, or the Worker just re-creates the wait.
      const wantsStream = body.stream === true;

      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: Math.min(requestedTokens, MAX_TOKENS_CAP),
          // Prompt caching: the system prompt (persona + knowledge base) is
          // large and identical on every call, so it's marked cacheable.
          // Repeat reads bill at ~10% of normal input price. Output is
          // byte-for-byte identical — this is purely a billing mechanism.
          system: typeof body.system === "string"
            ? [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }]
            : body.system,
          messages: body.messages,
          ...(wantsStream ? { stream: true } : {}),
        }),
      });

      // Pipe the stream through untouched. Errors still arrive as JSON, so
      // a failed streaming request is handled by the normal path below.
      if (wantsStream && anthropicRes.ok && anthropicRes.body) {
        return new Response(anthropicRes.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }

      const data = await anthropicRes.json();

      return new Response(JSON.stringify(data), {
        status: anthropicRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
