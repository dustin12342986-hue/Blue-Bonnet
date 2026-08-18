import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
const dom = new JSDOM(readFileSync("index.html","utf8"), { runScripts:"dangerously", pretendToBeVisual:true, url:"https://example.com/" });
await new Promise(r=>setTimeout(r,700));
const w = dom.window, ev = (s)=>w.eval(s);
let p=0,f=0; const check=(n,c,d="")=>{(c?p++:f++);console.log((c?"PASS":"FAIL")+" - "+n+(c?"":"   "+d));};
const reset = () => ev("window.__bb.memory = JSON.parse(JSON.stringify(window.__bb.defaultMemory))");
reset();

// 1. Raw fidelity
ev(`window.__bb.recordEpisode([
  {role:"user", text:"i keep putting off calling the insurance people"},
  {role:"assistant", text:"That's a phone-call task, which is its own category of hard."}
])`);
check("episode stored", ev("window.__bb.memory.episodes.length") === 1);
const raw = ev("window.__bb.recentRaw()");
check("raw text is verbatim, not summarised", /insurance people/.test(raw) && /own category of hard/.test(raw));
check("raw text is speaker-labelled", /Them:/.test(raw) && /You:/.test(raw));
check("raw text is dated", /\[\d{4}-\d{2}-\d{2}\]/.test(raw));

// 2. Nothing is filtered at storage time
reset();
ev(`window.__bb.recordEpisode([{role:"user", text:"we had a rough argument last night and i shut down"}])`);
check("hard content is retained verbatim", /rough argument/.test(ev("window.__bb.recentRaw()")));

// 3. Eviction distills rather than deletes
reset();
ev(`for (let i=0;i<410;i++) window.__bb.recordEpisode([{role:"user", text:"episode number "+i+" about the garage door and the fence"}]);`);
check("episode count is bounded", ev("window.__bb.memory.episodes.length") <= 400);
check("evicted episodes became notes", ev("window.__bb.memory.facts.length") > 0);
check("newest episode survives", /episode number 409/.test(ev("window.__bb.recentRaw(2000)")));

// 4. Byte budget respected
reset();
ev(`const big = "x".repeat(3500);
    for (let i=0;i<250;i++) window.__bb.recordEpisode([{role:"user", text: big}]);`);
check("byte budget enforced", ev("window.__bb.episodesSize()") <= 620000, String(ev("window.__bb.episodesSize()")));

// 5. Raw window is bounded for the request
reset();
ev(`for (let i=0;i<200;i++) window.__bb.recordEpisode([{role:"user", text:"a fairly long turn about scheduling ".repeat(20)}]);`);
check("raw window respects char cap", ev("window.__bb.recentRaw(14000).length") <= 14200, String(ev("window.__bb.recentRaw(14000).length")));

// 6. Harmonic layer still intact
reset();
ev('window.__bb.observeFacts(["a","b"]); window.__bb.observeFacts(["a"]);');
check("harmonic notes still work", ev("window.__bb.memory.facts[0].hits") === 2);
check("resonance links still form", Object.keys(JSON.parse(ev("JSON.stringify(window.__bb.memory.facts[0].links)"))).length === 1);

console.log(`\n${p}/${p+f} passed`);
