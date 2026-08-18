import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
const dom = new JSDOM(readFileSync("index.html","utf8"), { runScripts:"dangerously", pretendToBeVisual:true, url:"https://example.com/" });
await new Promise(r=>setTimeout(r,700));
const w = dom.window, B = () => w.__bb;
const ev = (s) => w.eval(s);
let pass=0, fail=0;
const check=(n,c,d="")=>{ (c?pass++:fail++); console.log((c?"PASS":"FAIL")+" - "+n+(c?"":"   "+d)); };
const reset = () => ev("window.__bb.memory = JSON.parse(JSON.stringify(window.__bb.defaultMemory))");

check("test hook present", !!B());
reset();

// 1. Notes with amplitude
ev('window.__bb.observeFacts(["struggles to start phone calls","works nights"])');
check("facts stored as notes", ev("window.__bb.memory.facts.length") === 2);
check("notes carry amplitude", ev("typeof window.__bb.memory.facts[0].amplitude") === "number");

// 2. Reinforcement
const before = ev("window.__bb.amplitudeOf(window.__bb.memory.facts[0])");
ev('window.__bb.observeFacts(["struggles to start phone calls"])');
const after = ev("window.__bb.amplitudeOf(window.__bb.memory.facts[0])");
check("re-hearing reinforces", after > before, `${before.toFixed(3)} -> ${after.toFixed(3)}`);
check("hit count increments", ev("window.__bb.memory.facts[0].hits") === 2);
check("no duplicate created", ev("window.__bb.memory.facts.length") === 2);

// 3. Decay
ev('window.__bb.memory.facts[1].lastHeard = Date.now() - 21*86400000; window.__bb.memory.facts[1].amplitude = 1; window.__bb.memory.facts[1].hits = 1;');
const decayed = ev("window.__bb.amplitudeOf(window.__bb.memory.facts[1])");
check("one half-life halves amplitude", Math.abs(decayed - 0.5) < 0.02, decayed.toFixed(3));

// 4. Consolidation
ev('window.__bb.memory.facts[0].hits = 8; window.__bb.memory.facts[0].amplitude = 1; window.__bb.memory.facts[0].lastHeard = Date.now() - 21*86400000;');
const slow = ev("window.__bb.amplitudeOf(window.__bb.memory.facts[0])");
check("often-heard facts decay slower", slow > decayed, `${slow.toFixed(3)} vs ${decayed.toFixed(3)}`);

// 5. Resonance
reset();
ev('window.__bb.observeFacts(["avoids paperwork","misses deadlines on forms"])');
check("co-occurring facts link", Object.keys(JSON.parse(ev("JSON.stringify(window.__bb.memory.facts[0].links)"))).length === 1);
ev('window.__bb.memory.facts[1].lastHeard = Date.now() - 10*86400000; window.__bb.memory.facts[1].amplitude = 0.4;');
const pB = ev("window.__bb.amplitudeOf(window.__bb.memory.facts[1])");
ev('window.__bb.observeFacts(["avoids paperwork"])');
const pA = ev("window.__bb.amplitudeOf(window.__bb.memory.facts[1])");
check("reinforcing one lifts its resonant partner", pA > pB, `${pB.toFixed(3)} -> ${pA.toFixed(3)}`);

// 6. Pruning by resonance, not by count
reset();
ev(`window.__bb.observeFacts(["a passing detail"]);
    window.__bb.memory.facts[0].lastHeard = Date.now() - 400*86400000;
    window.__bb.observeFacts(["something new"]);`);
check("long-faded facts are released", !ev('window.__bb.memory.facts.some(f=>f.text==="a passing detail")'));
check("recent fact retained", ev('window.__bb.memory.facts.some(f=>f.text==="something new")'));

// 7. Surfacing threshold
reset();
ev(`window.__bb.observeFacts(["loud one"]); window.__bb.observeFacts(["quiet one"]);
    window.__bb.memory.facts[1].amplitude = 0.1; window.__bb.memory.facts[1].lastHeard = Date.now();`);
const surf = JSON.parse(ev('JSON.stringify(window.__bb.liveFacts().map(x=>x.f.text))'));
check("quiet facts stay out of context", !surf.includes("quiet one"));
check("loud facts surface", surf.includes("loud one"));

// 8. Migration
reset();
ev('window.__bb.memory.facts = ["old style fact"]; window.__bb.migrateMemory();');
check("v1 string facts migrate", ev("typeof window.__bb.memory.facts[0]") === "object" && ev('window.__bb.memory.facts[0].text') === "old style fact");
check("migrated facts get amplitude", ev("typeof window.__bb.memory.facts[0].amplitude") === "number");

// 9. Insights panel
ev(`window.__bb.memory.insights = [{id:"i1", text:"seems to stall on anything with a phone call", dismissed:false, createdAt:Date.now()}];
    window.__bb.renderInsights();`);
const item = dom.window.document.querySelector(".insight-item");
check("insight shows in panel", !!item);
check("insight text visible to the person", !!item && /stall/.test(item.textContent));
if (item) item.querySelector("button").click();
check("dismissing hides it", ev("window.__bb.memory.insights[0].dismissed") === true);
check("dismissed insight kept, not deleted", ev("window.__bb.memory.insights.length") === 1);

// 10. Context
reset();
ev(`window.__bb.observeFacts(["recurring thing"]); window.__bb.observeFacts(["recurring thing"]); window.__bb.observeFacts(["recurring thing"]);
    window.__bb.memory.insights=[{id:"i2",text:"tends to work best late",dismissed:false,createdAt:Date.now()}];`);
const ctx = ev("window.__bb.buildMemoryContext()");
check("context weights by amplitude", /recurring/.test(ctx));
check("insights framed as hypotheses", /HYPOTHES/i.test(ctx));
check("insights told to be held loosely", /loosely/i.test(ctx));
check("dismissed insights excluded from context", !/stall on anything/.test(ctx));

console.log(`\n${pass}/${pass+fail} passed`);
