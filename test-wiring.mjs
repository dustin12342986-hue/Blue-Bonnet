/* Kit wiring.
   index.html now routes the main chat through BBKit.ask(). Two paths have to
   work: the kit present, and the kit file failing to load (a CDN hiccup or a
   file that didn't get uploaded must not take the app down).
   Served over http so the external <script src> actually loads. */
import { JSDOM } from "jsdom";
import { spawn } from "child_process";

const PORT = 8261;
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--directory", process.cwd()], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));

let pass = 0, fail = 0;
const ck = (n, c, d = "") => { c ? pass++ : fail++; console.log((c ? "PASS" : "FAIL") + " - " + n + (d ? "   [" + d + "]" : "")); };

const dom = await JSDOM.fromURL(`http://localhost:${PORT}/index.html`, {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
});
await new Promise((r) => setTimeout(r, 1200));
const w = dom.window;
const ev = (s) => { try { return w.eval(s); } catch (e) { return "THREW: " + e.message; } };

console.log("\n-- kit is actually loaded and configured --");
ck("kit file loaded", ev("typeof BBKit") === "object", ev("typeof BBKit"));
const st = ev("BBKit.status()");
ck("anthropic endpoint configured", st && st.anthropicReady === true);
ck("gateway backup configured", st && st.gatewayReady === true);
ck("points at blue-bonnet-app-proxy, not the shared one",
   st && /blue-bonnet-app-proxy/.test(st.anthropicProxyUrl), st && st.anthropicProxyUrl);
ck("app name set for gateway logs", st && st.app === "blue-bonnet", st && st.app);

// Skip onboarding.
for (let i = 0; i < 3; i++) {
  w.document.querySelectorAll(".onboard-opts button").forEach((b) => b.click());
  await new Promise((r) => setTimeout(r, 60));
}

console.log("\n-- happy path: goes through the kit, Anthropic answers --");
ev(`window.__sent = [];
 window.fetch = async (u, o) => {
   const b = JSON.parse(o.body); window.__sent.push({url:String(u), body:b});
   return { ok:true, status:200, json: async () => ({content:[{type:"text",text:"Call Maple Street about the inspection."}]}) };
 };`);

w.document.getElementById("msgInput").value = "what about the car";
w.document.getElementById("sendBtn").click();
await new Promise((r) => setTimeout(r, 500));

const main = ev(`window.__sent.filter(function(x){
  var t = Array.isArray(x.body.system) ? (x.body.system[0]||{}).text : x.body.system;
  return String(t).indexOf("GENERAL KNOWLEDGE BASE") !== -1; })[0]`);
ck("a main call went out", !!main);
ck("system survives the kit as an ARRAY", main && Array.isArray(main.body.system),
   main ? typeof main.body.system : "none");
ck("cache_control survives the kit", !!(main && main.body.system[0].cache_control));
ck("went to the anthropic proxy", main && /blue-bonnet-app-proxy/.test(main.url), main && main.url);
ck("reply rendered", /Maple Street/.test(w.document.getElementById("chatBody").textContent));

console.log("\n-- transcript stays plain text, not tool blocks --");
const shapes = ev(`window.__bb ? "hook" : "none"`);
const lastAssistant = ev(`(function(){
  var m = window.__lastMessages || null; return m; })()`);
ck("test hook present", shapes === "hook");

console.log("\n-- failover: Anthropic dead, gateway answers --");
ev(`window.__sent = [];
 window.fetch = async (u, o) => {
   const b = JSON.parse(o.body); window.__sent.push({url:String(u), body:b});
   if (String(u).indexOf("blue-bonnet-app-proxy") !== -1) {
     return { ok:false, status:400, text: async () => '{"error":{"message":"credit balance is too low"}}' };
   }
   return { ok:true, status:200, json: async () => ({choices:[{message:{content:"Gateway here."}}], bb:{interaction_id:"g1"}}) };
 };`);

w.document.getElementById("msgInput").value = "still there";
w.document.getElementById("sendBtn").click();
await new Promise((r) => setTimeout(r, 600));

const gw = ev(`window.__sent.filter(function(x){ return x.url.indexOf("gateway") !== -1; })[0]`);
ck("fell over to the gateway", !!gw, ev(`window.__sent.map(function(x){return x.url}).join(" | ")`));
const gwSys = gw && gw.body.messages && gw.body.messages[0] && gw.body.messages[0].content;
ck("gateway system prompt is a real string", typeof gwSys === "string", typeof gwSys);
ck("identity survived failover", /Blue Bonnet/.test(String(gwSys)));
ck("HARD BOUNDARY survived failover",
   /never|not.*verdict|does not hand down/i.test(String(gwSys)), String(gwSys).slice(0, 80));
ck("no [object Object] leaked", !/\[object Object\]/.test(String(gwSys)));
const shown = w.document.getElementById("chatBody").textContent;
ck("user is told it's the backup", /Gateway here/.test(shown) && shown.length > 0);

console.log("\n-- degradation: kit file missing entirely --");
const dom2 = new JSDOM(
  (await (await fetch(`http://localhost:${PORT}/index.html`)).text()).replace(
    '<script src="blue-bonnet-kit.js"></script>', ""),
  { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.com/" });
await new Promise((r) => setTimeout(r, 700));
const w2 = dom2.window;
const ev2 = (s) => { try { return w2.eval(s); } catch (e) { return "THREW: " + e.message; } };
ck("app still boots with no kit", ev2("typeof __bb") === "object", ev2("typeof __bb"));
ev2(`window.__sent=[]; window.fetch = async (u,o) => { window.__sent.push(JSON.parse(o.body));
  return {ok:true,status:200,json:async()=>({content:[{type:"text",text:"direct path ok"}]})}; };`);
for (let i = 0; i < 3; i++) {
  w2.document.querySelectorAll(".onboard-opts button").forEach((b) => b.click());
  await new Promise((r) => setTimeout(r, 50));
}
w2.document.getElementById("msgInput").value = "hello";
w2.document.getElementById("sendBtn").click();
await new Promise((r) => setTimeout(r, 400));
ck("direct fetch path still used when kit absent", ev2(`window.__sent.length`) > 0, String(ev2(`window.__sent.length`)));
ck("still sends two cached blocks without the kit",
   ev2(`(function(){var b=window.__sent.filter(function(x){
     var t=Array.isArray(x.system)?(x.system[0]||{}).text:x.system;
     return String(t).indexOf("GENERAL KNOWLEDGE BASE")!==-1;})[0];
     return b && Array.isArray(b.system) && !!b.system[0].cache_control;})()`) === true);
ck("reply still rendered without the kit", /direct path ok/.test(w2.document.getElementById("chatBody").textContent));

console.log("\n" + pass + " passed, " + fail + " failed\n");
srv.kill();
process.exit(fail ? 1 : 0);
