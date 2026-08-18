/* The seam.
   test-memory and test-episodes drive the memory modules directly through
   window.__bb. That's why a dead extraction path sat behind 36 passing
   tests for a whole session: nothing crossed the boundary between "the API
   replied" and "memory changed". This suite only tests that crossing. */
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const dom = new JSDOM(readFileSync("index.html", "utf8"), {
  runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.com/",
});
await new Promise((r) => setTimeout(r, 700));
const w = dom.window, B = w.__bb;
let pass = 0, fail = 0;
const ck = (n, c, d = "") => { c ? pass++ : fail++; console.log((c ? "PASS" : "FAIL") + " - " + n + (d ? "   [" + d + "]" : "")); };

// Stub the proxy. The extraction reply is exactly the shape the real model
// returns: a little prose, then the JSON.
w.eval(`
window.__sent = [];
window.fetch = async (u, o) => {
  const b = JSON.parse(o.body);
  window.__sent.push(b);
  const sys = typeof b.system === "string" ? b.system : "";
  const isExtract = sys.indexOf("Extract durable memory") === 0;
  const payload = isExtract
    ? 'Here you go:\\n{"facts":["Has a dog named Biscuit","Struggles to start laundry"],"openThreads":["book the vet"]}'
    : "ok";
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: payload }] }) };
};`);

console.log("\n-- extraction actually reaches memory --");
const factsBefore = B.memory.facts.length;
const threadsBefore = B.memory.openThreads.length;

B.clearMessages();
B.pushMessage({ role: "user", content: "my dog Biscuit needs the vet and I can't start the laundry" });
B.pushMessage({ role: "assistant", content: "ok" });
await B.updateMemoryFromConversation();

const factsAfter = B.memory.facts.length;
const threadsAfter = B.memory.openThreads.length;

ck("the extraction call was made", w.eval("window.__sent.length") > 0);
ck("facts land in harmonic memory", factsAfter > factsBefore, factsBefore + " -> " + factsAfter);
ck("open threads populate", threadsAfter > threadsBefore, threadsBefore + " -> " + threadsAfter);
ck("check-in feature has something to check in on", B.memory.openThreads.some((t) => t.text === "book the vet"),
   JSON.stringify(B.memory.openThreads.map((t) => t.text)));
ck("a fact survived verbatim", B.memory.facts.some((f) => /Biscuit/.test(f.text)),
   JSON.stringify(B.memory.facts.map((f) => f.text)));

console.log("\n-- the JSON the model really sends is parseable --");
const shapes = [
  '{"facts":["a"],"openThreads":[]}',
  'Here you go:\n{"facts":["a"],"openThreads":[]}',
  '```json\n{"facts":["a"],"openThreads":[]}\n```',
];
shapes.forEach((raw, i) => {
  const m = raw.match(/\{[\s\S]*\}/);
  ck("shape " + (i + 1) + " parses", !!m && !!JSON.parse(m[0]).facts);
});

console.log("\n-- prompt caching --");
const blocksA = B.systemBlocks("what about the dog");
ck("system is an array of blocks", Array.isArray(blocksA), typeof blocksA);
ck("first block is marked cacheable", blocksA[0].cache_control && blocksA[0].cache_control.type === "ephemeral");
ck("knowledge base is inside the cached block", blocksA[0].text.length > 3000, String(blocksA[0].text.length));
ck("no memory inside the cached block", blocksA[0].text.indexOf("WHAT YOU KNOW") === -1);

// Assert on what sendMessage ACTUALLY puts on the wire, not on what the
// helper returns in isolation. Testing the helper passed against a build
// where sendMessage had been changed back to string concatenation, which is
// exactly the blind spot that let the original bug through.
w.eval(`window.__sent.length = 0;`);
const inputEl = w.document.getElementById("msgInput");
const sendEl = w.document.getElementById("sendBtn");
w.document.querySelectorAll(".onboard-opts button").forEach((b) => b.click());
await new Promise((r) => setTimeout(r, 60));
w.document.querySelectorAll(".onboard-opts button").forEach((b) => b.click());
await new Promise((r) => setTimeout(r, 60));
w.document.querySelectorAll(".onboard-opts button").forEach((b) => b.click());
await new Promise((r) => setTimeout(r, 60));
inputEl.value = "what about the dog";
sendEl.click();
await new Promise((r) => setTimeout(r, 400));

const onWire = w.eval(`window.__sent.filter(function(b){
  var t = typeof b.system === "string" ? b.system : (b.system && b.system[0] && b.system[0].text) || "";
  return t.indexOf("GENERAL KNOWLEDGE BASE") !== -1;
})[0]`);
ck("sendMessage put a real call on the wire", !!onWire);
ck("what sendMessage SENDS is an array, not a string", onWire && Array.isArray(onWire.system),
   onWire ? typeof onWire.system : "none");
ck("what sendMessage SENDS carries cache_control",
   !!(onWire && onWire.system && onWire.system[0] && onWire.system[0].cache_control));

B.observeFacts(["Just heard something brand new"]);
B.recordEpisode([{ role: "user", text: "and the car needs an inspection" }, { role: "assistant", text: "ok" }]);
const blocksB = B.systemBlocks("what about the car");

ck("cached prefix is byte-identical after memory changes", blocksA[0].text === blocksB[0].text);
ck("volatile block is where the change shows up",
   (blocksA[1] ? blocksA[1].text : "") !== (blocksB[1] ? blocksB[1].text : ""));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
