import { useState, useEffect, useRef, useCallback } from "react";
import { CHORD_IMAGES } from "./chordImages";
import { CHORD_AUDIO, DOWN_WAV, UP_WAV } from "./chordAudio";
import { CHORD_IMAGES_ANCHORS } from "./chordImages_anchors";
import { CHORD_AUDIO_ANCHORS } from "./chordAudio_anchors";
import { CHORD_IMAGES_VARIATIONS } from "./chordImages_variations";
import { CHORD_AUDIO_VARIATIONS } from "./chordAudio_variations";

// Merge all sets — variations last so they override originals
const ALL_CHORD_IMAGES = { ...CHORD_IMAGES, ...CHORD_IMAGES_ANCHORS, ...CHORD_IMAGES_VARIATIONS };
const ALL_CHORD_AUDIO  = { ...CHORD_AUDIO,  ...CHORD_AUDIO_ANCHORS,  ...CHORD_AUDIO_VARIATIONS  };
// Explicit E override — forces normalized version, bypasses original loud recording
ALL_CHORD_AUDIO["E_down"] = CHORD_AUDIO_VARIATIONS["E_down"];
ALL_CHORD_AUDIO["E_up"]   = CHORD_AUDIO_VARIATIONS["E_up"];

// ─── DATA ───────────────────────────────────────────────────────────────────

const CHORD_PACKS = {
  1: { name: "Pack #1 — The Anchored 4", label: "Anchor Fingering", chords: ["G","C","Em","D"], color: "#FFBE0B", useAnchors: true },
  2: { name: "Pack #2 — The Big 4",      label: "Beginner Essential", chords: ["G","C","Em","D"], color: "#FFBE0B" },
  3: { name: "Pack #3 — Folk & Pop",     label: "Minor Flavour", chords: ["Am","G","C","Fmaj7"], color: "#FFBE0B" },
  4: { name: "Pack #4 — Rock & Country", label: "Power Moves", chords: ["G","D","A","Bm"], color: "#FFD166" },
};

const STRUM_PATTERNS = {
  1: { name: "Pattern #1", active: [true,false,true,true,false,true,true,true], songs: ["Brown Eyed Girl","Good Riddance","I'm Yours"] },
  2: { name: "Pattern #2", active: [true,false,true,false,false,true,true,true], songs: ["Riptide","Wagon Wheel","Country Roads"] },
  3: { name: "Pattern #3", active: [true,false,false,false,true,false,true,true], songs: ["Sweet Home Alabama","Knockin' on Heaven's Door"] },
};

const DIRS16 = Array(16).fill(null).map((_,i) => i%2===0 ? "↓" : "↑");
const ALL_CHORDS = ["G","C","Em","D","Am","A","E","Dm","Bm","Fmaj7"];

// ─── CHORD CATEGORIES FOR ADVANCED ASSIGN MODE ───────────────────────────────
// When you add images/audio for these chords in chordImages.js and chordAudio.js,
// they will automatically show images and play audio in the app.
// Format for chordImages.js:  "CHORDNAME": "data:image/png;base64,XXX"
// Format for chordAudio.js:   "CHORDNAME_down": "data:audio/wav;base64,XXX"
//                              "CHORDNAME_up":   "data:audio/wav;base64,XXX"
const CHORD_CATEGORIES = {
  "7":   ["A7","Am7","B7","C7","D7","E7","G7"],
  "sus": ["Dsus4"],
  "add": ["Cadd9"],
  "/":   ["C/G","G/B","C/B","Am/G"],
};
// All chords available in the advanced assign mode picker
const ALL_CHORDS_EXTENDED = [
  ...ALL_CHORDS,
  ...Object.values(CHORD_CATEGORIES).flat(),
];
const BEATS_OPTIONS = [1, 2, 4];

// ─── RANDOM CHORD SEQUENCE ──────────────────────────────────────────────────
// Generates a shuffled sequence long enough for a full session.
// Adjacent chords are always different so transitions are never the same chord.
function makeRandSeq(len, total) {
  if(total <= 1) return Array(len).fill(0);
  const seq = [];
  while(seq.length < len) {
    // shuffle indices
    const arr = Array.from({length:total},(_,i)=>i).sort(()=>Math.random()-0.5);
    // ensure first element != last of previous run
    if(seq.length>0 && arr[0]===seq[seq.length-1]) {
      const swap = arr.findIndex((v,i)=>i>0&&v!==seq[seq.length-1]);
      if(swap>0) [arr[0],arr[swap]]=[arr[swap],arr[0]];
    }
    seq.push(...arr);
  }
  return seq;
}

// ─── CHORD VARIATION SYSTEM ──────────────────────────────────────────────────
// Slash chord display names → audio/image key
const CHORD_NAME_TO_KEY = {
  "C/G":"CG", "G/B":"GB", "C/B":"CB", "Am/G":"AmG",
  "Dsus4":"D_anchor", "Cadd9":"C_anchor",
};
function normalizeKey(chord) { return CHORD_NAME_TO_KEY[chord] || chord; }

// All available variations per base chord
// key = value stored in chordVariants, label = display in picker
const CHORD_VARIATION_MAP = {
  "G":     [{key:"G",label:"G"},{key:"G_anchor",label:"Anchored"},{key:"G7",label:"G7"}],
  "C":     [{key:"C",label:"C"},{key:"C_anchor",label:"Cadd9"},{key:"C7",label:"C7"},{key:"C/G",label:"C/G"},{key:"C/B",label:"C/B"}],
  "Em":    [{key:"Em",label:"Em"},{key:"Em_anchor",label:"Em7"}],
  "D":     [{key:"D",label:"D"},{key:"D_anchor",label:"Dsus4"},{key:"D7",label:"D7"}],
  "Am":    [{key:"Am",label:"Am"},{key:"Am7",label:"Am7"},{key:"Am/G",label:"Am/G"}],
  "A":     [{key:"A",label:"A"},{key:"A7",label:"A7"}],
  "E":     [{key:"E",label:"E"},{key:"E7",label:"E7"}],
  "Dm":    [{key:"Dm",label:"Dm"}],
  "Bm":    [{key:"Bm",label:"Bm"},{key:"B7",label:"B7"}],
  "Fmaj7": [{key:"Fmaj7",label:"Fmaj7"},{key:"F",label:"F (Easy)"}],
};
const HAS_VARIATIONS = new Set(Object.keys(CHORD_VARIATION_MAP).filter(c => CHORD_VARIATION_MAP[c].length > 1));

// ─── CHORD DRILL URL ENCODING ────────────────────────────────────────────────
function encodeChordDrill(chords, bpm, beatsPerChord, name) {
  return btoa(JSON.stringify({ c: chords, b: bpm, p: beatsPerChord, n: name||"" }));
}
function decodeChordDrill(str) {
  try {
    const obj = JSON.parse(atob(str));
    return { chords: Array.isArray(obj.c)?obj.c:[], bpm: Number(obj.b)||60, beatsPerChord: Number(obj.p)||2, name: obj.n||"" };
  } catch { return null; }
}

// ─── STRUM PATTERN URL ENCODING ─────────────────────────────────────────────
function encodeStrumDrill(name, strumActive, hasSecondRow, row1Size, row2Size, songChords, bpm, beatsPerChord) {
  const sa = strumActive.reduce((acc,v,i)=>{ if(v) acc.push(i); return acc; },[]);
  return btoa(JSON.stringify({ n:name, sa, r2:hasSecondRow?1:0, s1:row1Size, s2:row2Size, c:songChords, b:bpm, p:beatsPerChord }));
}
function decodeStrumDrill(str) {
  try {
    const obj = JSON.parse(atob(str));
    const strumActive = Array(16).fill(false);
    (obj.sa||[]).forEach(i=>{ if(i<16) strumActive[i]=true; });
    return { name:obj.n||"Shared Pattern", strumActive, hasSecondRow:!!obj.r2,
      row1Size:Number(obj.s1)||8, row2Size:Number(obj.s2)||8,
      songChords:Array.isArray(obj.c)?obj.c:[], bpm:Number(obj.b)||60, beatsPerChord:Number(obj.p)||2 };
  } catch { return null; }
}

// ─── KEY DETECTION ───────────────────────────────────────────────────────────
// Diatonic chords per key (limited to chords in our app)
const KEY_SETS = [
  { label: "G maj / E min",  chords: new Set(["G","Am","Bm","C","D","Em"]) },
  { label: "C maj / A min",  chords: new Set(["Am","C","Dm","Em","Fmaj7","G"]) },
  { label: "D maj / B min",  chords: new Set(["A","Bm","D","Em","G"]) },
  { label: "A maj / F# min", chords: new Set(["A","Bm","D","E"]) },
  { label: "F maj / D min",  chords: new Set(["Am","C","Dm","Fmaj7","G"]) },
];
function getPossibleKeys(selectedChords) {
  if(!selectedChords.length) return KEY_SETS;
  return KEY_SETS.filter(k => selectedChords.every(c => k.chords.has(c)));
}
function getAllowedChords(selectedChords) {
  const possible = getPossibleKeys(selectedChords);
  if(!selectedChords.length || !possible.length) return null; // null = no restriction
  return new Set(possible.flatMap(k => [...k.chords]));
}
// Strumming tab always uses anchor for these 4
const STRUM_ANCHOR_CHORDS = new Set(["G","C","Em","D"]);

// Resolve chord to image/audio key based on selected variant
function resolveKey(chord, variants) {
  const selected = variants?.[chord];
  return normalizeKey(selected || chord);
}
function getChordImg(chord, variants) {
  const key = resolveKey(chord, variants);
  return ALL_CHORD_IMAGES[key] || ALL_CHORD_IMAGES[normalizeKey(chord)] || null;
}
function getAudioKey(chord, variants) { return resolveKey(chord, variants); }

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1],16)}, ${parseInt(r[2],16)}, ${parseInt(r[3],16)}` : "255,255,255";
}
function defaultBuild(len) { return Array(len).fill(null).map((_,i) => i%2===0); }
function generateRandomPattern() {
  return { name:"Random", active:[true,...Array(7).fill(null).map(()=>Math.random()>0.3)], songs:[] };
}
async function loadBuffer(ctx, b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return await ctx.decodeAudioData(bytes.buffer);
}

// ─── SHARED AUDIO HOOK ──────────────────────────────────────────────────────
function useAudio() {
  const ctxRef = useRef(null);
  const downRef = useRef(null);
  const upRef = useRef(null);
  const chordBufsRef = useRef({});
  const [ready, setReady] = useState(false);

  const init = useCallback(async () => {
    if (ctxRef.current) return ctxRef.current;
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    ctxRef.current = ctx;
    const chordKeys = Object.keys(ALL_CHORD_AUDIO);
    const [generic, chordBufs] = await Promise.all([
      Promise.all([loadBuffer(ctx,DOWN_WAV), loadBuffer(ctx,UP_WAV)]),
      Promise.all(chordKeys.map(k => loadBuffer(ctx, ALL_CHORD_AUDIO[k])))
    ]);
    downRef.current=generic[0]; upRef.current=generic[1];
    chordKeys.forEach((k,i) => { chordBufsRef.current[k]=chordBufs[i]; });
    setReady(true);
    return ctx;
  }, []);

  const playBuf = useCallback((buf, gain=1.0, semitones=0) => {
    const ctx=ctxRef.current; if(!ctx||!buf) return;
    const src=ctx.createBufferSource(), g=ctx.createGain();
    src.buffer=buf; src.connect(g); g.connect(ctx.destination);
    g.gain.value=gain;
    if(semitones !== 0) src.playbackRate.value = Math.pow(2, semitones/12);
    src.start(ctx.currentTime);
  }, []);

  const playClick = useCallback((accent) => {
    const ctx=ctxRef.current; if(!ctx) return;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value=accent?1000:600;
    g.gain.setValueAtTime(accent?0.35:0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.07);
    o.start(ctx.currentTime); o.stop(ctx.currentTime+0.07);
  }, []);

  const playStrum = useCallback((isDown) => {
    playBuf(isDown?downRef.current:upRef.current, isDown?1.0:0.75);
  }, [playBuf]);

  const playChordStrum = useCallback((chord, isDown, semitones=0) => {
    const key=chord+"_"+(isDown?"down":"up");
    const buf=chordBufsRef.current[key];
    const gainMult = chord.endsWith("_anchor") ? 0.85 : 1.0;
    playBuf(buf||(isDown?downRef.current:upRef.current), (isDown?1.0:0.75)*gainMult, semitones);
  }, [playBuf]);

  const playChordClick = useCallback((accent) => {
    const ctx=ctxRef.current; if(!ctx) return;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value=accent?1050:650;
    g.gain.setValueAtTime(accent?0.45:0.22, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.09);
    o.start(ctx.currentTime); o.stop(ctx.currentTime+0.09);
  }, []);

  return { init, playClick, playStrum, playChordStrum, playChordClick, ready, getContext: ()=>ctxRef.current };
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const hasSharedPattern = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("pattern");
  const hasSharedDrill = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("drill");
  const hasSharedStrum = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("strum");

  const [tab, setTab] = useState(hasSharedDrill ? "chords" : (hasSharedPattern||hasSharedStrum) ? "song" : "strum");
  const [buildMode, setBuildMode] = useState(hasSharedPattern ? "advanced" : "simple");
  const audio = useAudio();
  const [chordVariants, setChordVariants] = useState({G:"G",C:"C",Em:"Em",D:"D",Am:"Am",A:"A",E:"E",Dm:"Dm",Bm:"Bm","Fmaj7":"Fmaj7"});
  const updateVariant = (chord, variant) => setChordVariants(p=>({...p,[chord]:variant}));

  const handleTabChange = (newTab) => {
    // Suspend audio context to immediately silence everything
    try {
      const ctx = audio.getContext?.();
      if(ctx && ctx.state === "running") {
        ctx.suspend().then(()=>{ setTimeout(()=>ctx.resume(), 50); });
      }
    } catch(e){}
    setTab(newTab);
  };

  const tabs = [
    { id:"strum",  label:"🎸 Strumming" },
    { id:"chords", label:"🤚 Chords" },
    { id:"song",   label:"🎵 Build a Song" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" }}>

      {/* Brand Header */}
      <div style={{ textAlign:"center", padding:"14px 16px 0",
        background:"rgba(10,10,8,0.98)" }}>
        <div style={{ fontSize:13, fontWeight:700, color:"#fff", letterSpacing:1, marginBottom:2 }}>
          NO THEORY CLUB
        </div>
        <div style={{ fontSize:11, color:"#555", marginBottom:10 }}>
          Guitar Practice Tool
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ position:"sticky", top:0, zIndex:100,
        background:"rgba(10,10,8,0.97)", backdropFilter:"blur(12px)",
        borderBottom:"1px solid #2a1f00", padding:"0 16px 10px" }}>
        <div style={{ display:"flex", gap:4, maxWidth:560, margin:"0 auto",
          background:"#161208", borderRadius:14, padding:4, border:"1px solid #2a2a2a" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={()=>handleTabChange(t.id)} style={{
              flex:1, padding:"10px 8px", borderRadius:10, border:"none",
              background: tab===t.id
                ? t.id==="strum"
                  ? "linear-gradient(135deg, #FFD60A, #FFBE0B)"
                  : t.id==="chords"
                    ? "linear-gradient(135deg, #FFBE0B, #F79200)"
                    : "linear-gradient(135deg, #F79200, #E06000)"
                : "transparent",
              color: tab===t.id ? "#111" : "#555",
              fontSize:13, fontWeight:900,
              textShadow: tab===t.id ? "0 1px 4px rgba(0,0,0,0.3)" : "none",
              cursor:"pointer", transition:"all 0.2s",
              whiteSpace:"nowrap",
              boxShadow: tab===t.id ? "0 2px 12px rgba(255,190,11,0.35)" : "none",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ display: tab==="strum" ? "block" : "none" }}>
        <StrummingTab audio={audio} />
      </div>
      <div style={{ display: tab==="chords" ? "block" : "none" }}>
        <ChordsTab audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />
      </div>
      <div style={{ display: tab==="song" ? "block" : "none" }}>
        <BuildSongTab audio={audio} initialBuildMode={buildMode} chordVariants={chordVariants} updateVariant={updateVariant} />
      </div>
    </div>
  );
}

// ─── STRUMMING TAB ──────────────────────────────────────────────────────────
function StrummingTab({ audio }) {
  const { init, playClick, playStrum, playChordStrum } = audio;
  const [mode, setMode] = useState("practice");
  const [pattern, setPattern] = useState(null);
  const [activeBtn, setActiveBtn] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(60);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [buildActive, setBuildActive] = useState([...defaultBuild(8),...Array(8).fill(false)]);
  const [hasSecondRow, setHasSecondRow] = useState(false);
  const [row1Size, setRow1Size] = useState(8);
  const [row2Size, setRow2Size] = useState(8);
  const [strumChord, setStrumChord] = useState("G");
  const [savedStrums, setSavedStrums] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem("ntc_strum_tab")||"[]"); } catch{ return []; }
  });
  const [showSavedStrums, setShowSavedStrums] = useState(false);
  const [strumSavePrompt, setStrumSavePrompt] = useState(false);
  const [strumSaveName, setStrumSaveName] = useState("");

  const STRUM_CHORDS = ["G", "C", "Em", "D"];

  const intervalRef = useRef(null);
  const beatRef = useRef(-1);
  const bpmRef = useRef(bpm);
  const totalBeatsRef = useRef(8);
  const modeRef = useRef(mode);
  const patternRef = useRef(pattern);
  const buildActiveRef = useRef(buildActive);
  const strumChordRef = useRef(strumChord);
  const row1SizeRef = useRef(8);
  const hasSecondRowRef2 = useRef(false);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ modeRef.current=mode; },[mode]);
  useEffect(()=>{ patternRef.current=pattern; },[pattern]);
  useEffect(()=>{ buildActiveRef.current=buildActive; },[buildActive]);
  useEffect(()=>{ strumChordRef.current=strumChord; },[strumChord]);
  useEffect(()=>{ row1SizeRef.current=row1Size; },[row1Size]);
  useEffect(()=>{ hasSecondRowRef2.current=hasSecondRow; },[hasSecondRow]);
  useEffect(()=>{ totalBeatsRef.current = mode==="build" ? (hasSecondRow ? row1Size+row2Size : row1Size) : 8; },[mode,hasSecondRow,row1Size,row2Size]);

  const tick = useCallback(()=>{
    const total=totalBeatsRef.current;
    const next=(beatRef.current+1)%total;
    beatRef.current=next;
    const cm=modeRef.current;
    const r1 = row1SizeRef.current||8;
    const displayIdx = cm==="build" && next >= r1 ? 8+(next-r1) : next;
    setCurrentBeat(cm==="build" ? displayIdx : next);
    if(next%4===0) playClick(next===0);
    const isDown=(cm==="build" ? displayIdx : next)%2===0;
    // Map next (0..total-1) to strumActive array index
    const r1 = row1SizeRef.current||8;
    const mappedIdx = cm==="build" && next >= r1 ? 8+(next-r1) : next;
    let shouldStrum = cm==="build" ? buildActiveRef.current[mappedIdx]===true
      : patternRef.current ? patternRef.current.active[next]===true : true;
    if(shouldStrum) playChordStrum(STRUM_ANCHOR_CHORDS.has(strumChordRef.current)?strumChordRef.current+"_anchor":strumChordRef.current, isDown);
  },[playClick, playChordStrum]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    beatRef.current=-1;
    const ms=(60/bpmRef.current/4)*1000;
    intervalRef.current=setInterval(tick,ms);
    tick();
  },[tick]);

  const stopMetronome = useCallback(()=>{
    clearInterval(intervalRef.current); intervalRef.current=null;
    setCurrentBeat(-1); beatRef.current=-1;
  },[]);

  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[bpm]);
  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[hasSecondRow,row1Size,row2Size]);
  useEffect(()=>()=>clearInterval(intervalRef.current),[]);

  const handleTogglePlay = async ()=>{
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    else{await init();startMetronome();setIsPlaying(true);}
  };

  const totalBlocks = mode==="build" ? (hasSecondRow ? row1Size+row2Size : row1Size) : 8;
  const displayPattern = pattern ? pattern.active : Array(8).fill(true);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding:"24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      <SectionHeader title="Foundations of Strumming"
        sub="Every pattern uses the same motion — ghost strokes keep the rhythm, they just miss the strings." />

      <ModeTabs options={[["practice","🎸 Practice"],["build","🛠 Build"]]}
        value={mode} onChange={m=>{ setMode(m); stopMetronome(); setIsPlaying(false); }} />

      {/* Chord selector bar */}
      <div style={{ width:"100%", background:"#111", border:"1px solid #2a2a2a",
        borderRadius:14, padding:"12px 16px", marginBottom:18 }}>
        <div style={{ fontSize:11, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:10 }}>
          STRUM CHORD
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
          {STRUM_CHORDS.map(chord => {
            const isActive = strumChord === chord;
            return (
              <button key={chord} onClick={()=>setStrumChord(chord)} style={{
                flex:1, padding:"8px 4px", borderRadius:10,
                background: isActive ? "linear-gradient(135deg, #FFBE0B, #F77F00)" : "#1c1c1c",
                border: isActive ? "2px solid #FFBE0B" : "2px solid transparent",
                cursor:"pointer", transition:"background 0.15s, border-color 0.15s, box-shadow 0.15s",
                display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                boxShadow: isActive ? "0 0 12px rgba(255,190,11,0.4)" : "none",
              }}>
                {ALL_CHORD_IMAGES[STRUM_ANCHOR_CHORDS.has(chord)?chord+"_anchor":chord] && (
                  <div style={{ width:"100%", borderRadius:6, opacity: isActive ? 1 : 0.5, overflow:"hidden" }}>
                    <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
                    <img src={ALL_CHORD_IMAGES[STRUM_ANCHOR_CHORDS.has(chord)?chord+"_anchor":chord]} alt={chord}
                      style={{ width:"100%", height:"auto", display:"block" }} />
                  </div>
                  </div>
                )}
                <div style={{ fontSize:13, fontWeight:900,
                  color: isActive ? "#111" : "#666" }}>{chord}</div>
              </button>
            );
          })}
        </div>
      </div>

      {mode==="practice" && (
        <>
          <div style={{ marginBottom:10, textAlign:"center" }}>
            <span style={{ fontSize:17, fontWeight:700 }}>Universal Strumming </span>
            <span style={{ fontSize:17, fontWeight:700, color:"#FFBE0B" }}>"Motion"</span>
          </div>
          <div style={{ display:"flex", gap:7, marginBottom:20 }}>
            {Array(8).fill(null).map((_,i)=>(
              <Arrow key={i} dir={DIRS16[i]} active dim={false} beat={currentBeat===i&&isPlaying} />
            ))}
          </div>
          {pattern && (
            <>
              <div style={{ color:"#888", fontSize:13, marginBottom:4 }}>Reduced to</div>
              <div style={{ fontSize:16, fontWeight:700, marginBottom:10 }}>{pattern.name}</div>
              <div style={{ display:"flex", gap:7, marginBottom:6 }}>
                {displayPattern.map((a,i)=>(
                  <Arrow key={i} dir={DIRS16[i]} active={a} dim={!a} beat={currentBeat===i&&isPlaying} />
                ))}
              </div>
              <p style={{ fontSize:11, color:"#555", marginBottom:16 }}>⬛ ghost stroke — arm moves, misses strings</p>
            </>
          )}
          <div style={{ display:"flex", gap:8, marginBottom:24, flexWrap:"wrap", justifyContent:"center" }}>
            {[1,2,3].map(n=>(
              <PatternBtn key={n} label={`Pattern ${n}`} active={activeBtn===n}
                onClick={()=>{ setPattern(STRUM_PATTERNS[n]); setActiveBtn(n);
                  if(isPlaying){stopMetronome();setIsPlaying(false);} }} />
            ))}
            <PatternBtn label="🎲 Randomize" active={activeBtn==="random"} accent
              onClick={()=>{ setPattern(generateRandomPattern()); setActiveBtn("random");
                if(isPlaying){stopMetronome();setIsPlaying(false);} }} />
          </div>
        </>
      )}

      {mode==="build" && (
        <BuildStrumPanel buildActive={buildActive} setBuildActive={setBuildActive}
          hasSecondRow={hasSecondRow} setHasSecondRow={setHasSecondRow}
          row1Size={row1Size} setRow1Size={setRow1Size}
          row2Size={row2Size} setRow2Size={setRow2Size}
          currentBeat={currentBeat} isPlaying={isPlaying}
          stopMetronome={stopMetronome} setIsPlaying={setIsPlaying}
          savedStrums={savedStrums} setSavedStrums={setSavedStrums}
          showSavedStrums={showSavedStrums} setShowSavedStrums={setShowSavedStrums}
          strumSavePrompt={strumSavePrompt} setStrumSavePrompt={setStrumSavePrompt}
          strumSaveName={strumSaveName} setStrumSaveName={setStrumSaveName} />
      )}

      <MetronomePanel bpm={bpm} setBpm={setBpm} isPlaying={isPlaying}
        totalBlocks={totalBlocks} currentBeat={currentBeat}
        accentColor="#FFBE0B" onToggle={handleTogglePlay}
        canPlay={true} />
      {/* Copyright */}
      <div style={{ textAlign:"center", paddingTop:24, paddingBottom:8, color:"#333", fontSize:11 }}>
        © {new Date().getFullYear()} No Theory Club · All rights reserved.
      </div>
    </div>
  );
}

// ─── CHORDS TAB ─────────────────────────────────────────────────────────────
function ChordsTab({ audio, chordVariants, updateVariant }) {
  const { init, playChordClick, playChordStrum } = audio;
  const [viewMode, setViewMode] = useState("presets");
  const [selectedPack, setSelectedPack] = useState(null);
  const [customChords, setCustomChords] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(60);
  const [beatsPerChord, setBeatsPerChord] = useState(2);
  const [chordIndex, setChordIndex] = useState(0);
  const [beatCount, setBeatCount] = useState(0);

  const [randomOrder, setRandomOrder] = useState(false);
  const [randomNextDisplay, setRandomNextDisplay] = useState(0);
  const [savedDrills, setSavedDrills] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem("ntc_drills")||"[]"); } catch{ return []; }
  });
  const [showSavedDrills, setShowSavedDrills] = useState(false);
  const [drillSavePrompt, setDrillSavePrompt] = useState(false);
  const [drillSaveName, setDrillSaveName] = useState("");
  const [loadedDrillName, setLoadedDrillName] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(true);

  // Load drill from URL on first mount
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const drill = params.get("drill");
    if(drill){
      const decoded = decodeChordDrill(drill);
      if(decoded && decoded.chords.length >= 2){
        setViewMode("build");
        setCustomChords(decoded.chords);
        setBpm(decoded.bpm);
        setBeatsPerChord(decoded.beatsPerChord);
        const drillName = decoded.name || "Shared Drill";
        setLoadedDrillName(drillName);
        setDrillSaveName(drillName);
        setPickerOpen(false);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  // eslint-disable-next-line
  },[]);

  const intervalRef = useRef(null);
  const beatRef = useRef(0);
  const chordRef = useRef(0);
  const bpmRef = useRef(bpm);
  const bpcRef = useRef(beatsPerChord);
  const packRef = useRef(selectedPack);
  const customRef = useRef(customChords);
  const vmRef = useRef(viewMode);
  const firstTickRef = useRef(true);
  const randomOrderRef = useRef(false);
  const randomNextRef = useRef(0);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ bpcRef.current=beatsPerChord; },[beatsPerChord]);
  useEffect(()=>{ packRef.current=selectedPack; },[selectedPack]);
  useEffect(()=>{ customRef.current=customChords; },[customChords]);
  useEffect(()=>{ vmRef.current=viewMode; },[viewMode]);
  useEffect(()=>{ randomOrderRef.current=randomOrder; },[randomOrder]);

  const tick = useCallback(()=>{
    const chords = vmRef.current==="build" ? customRef.current
      : (packRef.current ? CHORD_PACKS[packRef.current].chords : []);
    if(!chords.length) return;
    const bpc=bpcRef.current, cur=beatRef.current, isFirst=cur===0;
    if(isFirst && !firstTickRef.current){
      if(randomOrderRef.current && chords.length>1){
        // The pre-decided "next" chord becomes "current"
        const incoming = randomNextRef.current;
        chordRef.current = incoming;
        setChordIndex(incoming);
        // Now pre-decide the NEW next — must differ from incoming
        let upcoming = Math.floor(Math.random() * chords.length);
        while(upcoming === incoming) upcoming = Math.floor(Math.random() * chords.length);
        randomNextRef.current = upcoming;
        setRandomNextDisplay(upcoming);
      } else {
        const next=(chordRef.current+1)%chords.length;
        chordRef.current=next; setChordIndex(next);
      }
    }
    firstTickRef.current=false;
    playChordClick(isFirst);
    // Play chord-specific strum on beat 1 (the accent beat)
    if(isFirst) { const pk=packRef.current?CHORD_PACKS[packRef.current]:null; const eff=pk?.useAnchors?{...chordVariants,...Object.fromEntries(["G","C","Em","D"].map(c=>[c,c+"_anchor"]))}:chordVariants; playChordStrum(getAudioKey(chords[chordRef.current], eff), true); }
    setBeatCount(cur);
    beatRef.current=(cur+1)%bpc;
  },[playChordClick, playChordStrum]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    beatRef.current=0; chordRef.current=0; firstTickRef.current=true;
    setChordIndex(0); setBeatCount(0);
    // Random mode: pick a random starting chord + pre-decide the next
    if(randomOrderRef.current) {
      const total = vmRef.current==="build" ? customRef.current.length : (packRef.current?CHORD_PACKS[packRef.current].chords.length:1);
      if(total > 1) {
        const curr = Math.floor(Math.random() * total);
        let nxt = Math.floor(Math.random() * total);
        while(nxt === curr) nxt = Math.floor(Math.random() * total);
        chordRef.current = curr;
        setChordIndex(curr);
        randomNextRef.current = nxt;
        setRandomNextDisplay(nxt);
      }
    }
    const ms=(60/bpmRef.current)*1000;
    intervalRef.current=setInterval(tick,ms);
    tick();
  },[tick]);

  const stopMetronome = useCallback(()=>{
    clearInterval(intervalRef.current); intervalRef.current=null;
    setBeatCount(0); beatRef.current=0; chordRef.current=0; setChordIndex(0);
  },[]);

  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[bpm,beatsPerChord]);
  useEffect(()=>()=>clearInterval(intervalRef.current),[]);

  const pack = selectedPack ? CHORD_PACKS[selectedPack] : null;
  const chords = viewMode==="build" ? customChords : (pack ? pack.chords : []);
  const nextChordIndex = chords.length>0 ? (randomOrder ? randomNextDisplay : (chordIndex+1)%chords.length) : 0;
  const accentColor = pack ? pack.color : "#FFBE0B";
  // eslint-disable-next-line
  const isLastBeat = isPlaying && beatsPerChord>1 && beatCount===beatsPerChord-1;
  const canPlay = viewMode==="build" ? customChords.length>=2 : !!selectedPack;
  const effectiveVariants = (selectedPack && CHORD_PACKS[selectedPack]?.useAnchors)
    ? {...chordVariants, G:"G_anchor", C:"C_anchor", Em:"Em_anchor", D:"D_anchor"}
    : chordVariants;

  const handleTogglePlay = async ()=>{
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    else if(canPlay){await init();startMetronome();setIsPlaying(true);}
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding:"24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      <SectionHeader title="Chord Switching"
        sub={<>The goal is a clean chord <em style={{color:"#666"}}>before</em> the beat hits.</>} />

      <ModeTabs options={[["presets","🎵 Presets"],["build","🛠 Build Your Own"]]}
        value={viewMode} onChange={m=>{ setViewMode(m); stopMetronome(); setIsPlaying(false);
          setChordIndex(0); setBeatCount(0); beatRef.current=0; chordRef.current=0; }} />

      {viewMode==="presets" && (
        <div style={{ width:"100%", marginBottom:20 }}>
          <div style={{ fontSize:11, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:10 }}>CHOOSE A PACK</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[1,2,3,4].map(num=>{
              const p=CHORD_PACKS[num], isActive=selectedPack===num;
              return (
                <button key={num} onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                  setSelectedPack(num); setChordIndex(0); setBeatCount(0); beatRef.current=0; chordRef.current=0; }} style={{
                  padding:"12px 18px", borderRadius:14,
                  border: isActive ? `2px solid ${p.color}` : "2px solid #2a2210",
                  background: isActive ? `rgba(${hexToRgb(p.color)}, 0.1)` : "#111",
                  cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between",
                  transition:"all 0.18s",
                }}>
                  <div style={{ textAlign:"left" }}>
                    <div style={{ fontSize:13, fontWeight:700, color:isActive?p.color:"#888" }}>{p.name}</div>
                    <div style={{ fontSize:11, color:"#555", marginTop:1 }}>{p.label}</div>
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    {p.chords.map(c=>(
                      <div key={c} style={{ width:30, height:30, borderRadius:8,
                        background:isActive?`rgba(${hexToRgb(p.color)},0.15)`:"#111009",
                        border:isActive?`1px solid rgba(${hexToRgb(p.color)},0.4)`:"1px solid #2a2210",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:11, fontWeight:800, color:isActive?p.color:"#444" }}>{c}</div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {viewMode==="build" && loadedDrillName && (
        <div style={{ width:"100%", textAlign:"center", marginBottom:4 }}>
          <div style={{ fontSize:18, fontWeight:900, color:"#fff", letterSpacing:0.3,
            textShadow:"0 2px 8px rgba(0,0,0,0.5)", marginBottom:2 }}>
            {loadedDrillName}
          </div>
        </div>
      )}

      {viewMode==="build" && (
        <>
          {pickerOpen && (
            <ChordPickerPanel customChords={customChords} setCustomChords={setCustomChords}
              maxChords={10} accentColor="#FFBE0B" isPlaying={isPlaying}
              stopMetronome={stopMetronome} setIsPlaying={setIsPlaying}
              setChordIndex={setChordIndex} setBeatCount={setBeatCount}
              beatRef={beatRef} chordRef={chordRef}
              chordVariants={chordVariants} updateVariant={updateVariant}
              allowDuplicates={true} />
          )}
          <button onClick={()=>setPickerOpen(o=>!o)} style={{
            width:"100%", marginBottom:12, padding:"8px",
            borderRadius:10, border:"1px solid #2a2a2a",
            background:"transparent",
            color:"#555", fontSize:11, fontWeight:700,
            cursor:"pointer", letterSpacing:1,
          }}>
            {pickerOpen ? "▲  HIDE BUILDER" : "▼  SHOW BUILDER"}
          </button>
        </>
      )}

      {chords.length>=2 && (
        <ChordGrid chords={chords} chordIndex={chordIndex} nextChordIndex={nextChordIndex}
          isPlaying={isPlaying} accentColor={accentColor} isLastBeat={isLastBeat}
          bpm={bpm} beatsPerChord={beatsPerChord}
          chordVariants={effectiveVariants} updateVariant={updateVariant} />
      )}

      {chords.length>=2 && (
        <div style={{ width:"100%", marginBottom:20 }}>
          <div style={{ fontSize:11, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:10 }}>BEATS PER CHORD</div>
          <div style={{ display:"flex", gap:8, justifyContent:"center", alignItems:"center", flexWrap:"wrap" }}>
            {BEATS_OPTIONS.map(b=>(
              <button key={b} onClick={()=>{ setBeatsPerChord(b); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
                padding:"9px 26px", borderRadius:10,
                border: beatsPerChord===b ? `2px solid ${accentColor}` : "2px solid #2a2210",
                background: beatsPerChord===b ? `rgba(${hexToRgb(accentColor)},0.12)` : "#111",
                color: beatsPerChord===b ? accentColor : "#555",
                fontSize:15, fontWeight:800, cursor:"pointer",
              }}>{b}</button>
            ))}
            <button onClick={()=>{
              const next = !randomOrder;
              setRandomOrder(next);
              randomOrderRef.current = next;
              if(isPlaying){stopMetronome();setIsPlaying(false);}
              if(next && chords.length>0){
                // Pre-decide next chord so carousel shows it right away
                const curr = chordIndex % chords.length;
                let nxt = Math.floor(Math.random() * chords.length);
                while(nxt === curr) nxt = Math.floor(Math.random() * chords.length);
                randomNextRef.current = nxt;
                setRandomNextDisplay(nxt);
              }
            }} style={{
              padding:"9px 14px", borderRadius:10,
              border: randomOrder ? `2px solid ${accentColor}` : "2px solid #2a2210",
              background: randomOrder ? `rgba(${hexToRgb(accentColor)},0.12)` : "#111",
              color: randomOrder ? accentColor : "#555",
              fontSize:15, fontWeight:800, cursor:"pointer",
              display:"flex", alignItems:"center", gap:5,
              boxShadow: randomOrder ? `0 0 10px rgba(${hexToRgb(accentColor)},0.3)` : "none",
            }}>🔀</button>
          </div>
          {/* Beat dots */}
          <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:14 }}>
            {Array(beatsPerChord).fill(null).map((_,i)=>(
              <div key={i} style={{ width:14, height:14, borderRadius:"50%",
                background: isPlaying&&beatCount===i ? accentColor : i===0?"#2a1f00":"#111009",
                border:`1px solid ${i===0?accentColor+"44":"#2a1f00"}`,
                boxShadow: isPlaying&&beatCount===i?`0 0 8px rgba(${hexToRgb(accentColor)},0.7)`:"none",
                transition:"background 0.05s" }} />
            ))}
          </div>
        </div>
      )}

      <MetronomePanel bpm={bpm} setBpm={setBpm} isPlaying={isPlaying}
        totalBlocks={4} currentBeat={-1} accentColor={accentColor}
        onToggle={handleTogglePlay} canPlay={canPlay}
        disabledLabel={viewMode==="build"?"Select 2+ chords":"Select a pack"} />

      {viewMode==="build" && (
        <div style={{ width:"100%", marginBottom:8 }}>
          {/* Save / Load row */}
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <button onClick={()=>{ if(customChords.length>=2) setDrillSavePrompt(p=>!p); }} style={{
              flex:1, padding:"10px", borderRadius:12,
              border: customChords.length>=2 ? "1px solid #FFBE0B44" : "1px solid #2a2a2a",
              background: customChords.length>=2 ? "rgba(255,190,11,0.07)" : "#0d0d0d",
              color: customChords.length>=2 ? "#FFBE0B" : "#333",
              fontSize:13, fontWeight:700,
              cursor: customChords.length>=2 ? "pointer" : "not-allowed" }}>💾 Save</button>
            <button onClick={()=>setShowSavedDrills(s=>!s)} style={{
              flex:1, padding:"10px", borderRadius:12,
              border:"1px solid #2a2a2a", background:"#111",
              color:"#888", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              📂 My Drills <span style={{color:"#555",fontWeight:400}}>({savedDrills.length})</span>
            </button>
          </div>

          {/* Save prompt */}
          {drillSavePrompt && (
            <div style={{ marginBottom:8, background:"#111", border:"1px solid #FFBE0B33",
              borderRadius:14, padding:"14px" }}>
              <div style={{ fontSize:12, color:"#888", marginBottom:8, textAlign:"center" }}>Name this drill</div>
              <div style={{ display:"flex", gap:8 }}>
                <input autoFocus value={drillSaveName} onChange={e=>setDrillSaveName(e.target.value)}
                  onKeyDown={e=>{ if(e.key==="Enter"){
                    if(!drillSaveName.trim()) return;
                    const drill = { id:Date.now(), name:drillSaveName.trim(),
                      chords:customChords, bpm, beatsPerChord,
                      savedAt:new Date().toLocaleDateString() };
                    const updated=[...savedDrills, drill];
                    setSavedDrills(updated);
                    localStorage.setItem("ntc_drills", JSON.stringify(updated));
                    setDrillSavePrompt(false); setDrillSaveName(""); setShowSavedDrills(true);
                  }}}
                  placeholder="e.g. G C G D practice..."
                  style={{ flex:1, padding:"9px 12px", borderRadius:10,
                    border:"1px solid #333", background:"#0a0a0a",
                    color:"#fff", fontSize:13, outline:"none" }} />
                <button onClick={()=>{
                  if(!drillSaveName.trim()) return;
                  const drill = { id:Date.now(), name:drillSaveName.trim(),
                    chords:customChords, bpm, beatsPerChord,
                    savedAt:new Date().toLocaleDateString() };
                  const updated=[...savedDrills, drill];
                  setSavedDrills(updated);
                  localStorage.setItem("ntc_drills", JSON.stringify(updated));
                  setDrillSavePrompt(false); setDrillSaveName(""); setShowSavedDrills(true);
                }} style={{ padding:"9px 16px", borderRadius:10, border:"none",
                  background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                  color:"#111", fontSize:13, fontWeight:800, cursor:"pointer" }}>Save</button>
                <button onClick={()=>{setDrillSavePrompt(false);setDrillSaveName("");}} style={{
                  padding:"9px 12px", borderRadius:10, border:"1px solid #333",
                  background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>✕</button>
              </div>
            </div>
          )}

          {/* Saved drills list */}
          {showSavedDrills && (
            <div style={{ marginBottom:8, display:"flex", flexDirection:"column", gap:6 }}>
              {savedDrills.length===0 && (
                <div style={{ textAlign:"center", color:"#444", fontSize:13, padding:"14px 0" }}>
                  No saved drills yet — build something and hit 💾
                </div>
              )}
              {savedDrills.map((d)=>(
                <div key={d.id} style={{ background:"#111", border:"1px solid #2a2a2a",
                  borderRadius:12, padding:"10px 14px",
                  display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:800, color:"#fff",
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{d.name}</div>
                    <div style={{ fontSize:11, color:"#555", marginTop:2 }}>
                      {d.chords.join(" → ")} · {d.bpm} BPM · {d.beatsPerChord} beat{d.beatsPerChord!==1?"s":""}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:6, marginLeft:10 }}>
                    <button onClick={()=>{
                      if(isPlaying){stopMetronome();setIsPlaying(false);}
                      setCustomChords(d.chords); setBpm(d.bpm); setBeatsPerChord(d.beatsPerChord);
                      setChordIndex(0); setBeatCount(0); beatRef.current=0; chordRef.current=0;
                      setLoadedDrillName(d.name);
                      setShowSavedDrills(false);
                    }} style={{ padding:"6px 12px", borderRadius:8, border:"none",
                      background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                      color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                    <button onClick={()=>{
                      const encoded = encodeChordDrill(d.chords, d.bpm, d.beatsPerChord, d.name);
                      const url = `${window.location.origin}${window.location.pathname}?drill=${encoded}`;
                      navigator.clipboard?.writeText(url)
                        .then(()=>alert(`✅ Link copied!\n\nShare "${d.name}" with your members.`))
                        .catch(()=>prompt("Copy this link:", url));
                    }} style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #333",
                      background:"transparent", color:"#6b9fff", fontSize:12,
                      fontWeight:700, cursor:"pointer" }}>🔗 Share</button>
                    <button onClick={()=>{
                      const updated = savedDrills.filter(x=>x.id!==d.id);
                      setSavedDrills(updated);
                      localStorage.setItem("ntc_drills", JSON.stringify(updated));
                    }} style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #333",
                      background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Copyright */}
      <div style={{ textAlign:"center", paddingTop:24, paddingBottom:8, color:"#333", fontSize:11 }}>
        © {new Date().getFullYear()} No Theory Club · All rights reserved.
      </div>
    </div>
  );
}

// ─── BUILD A SONG TAB ────────────────────────────────────────────────────────
function BuildSongTab({ audio, initialBuildMode="simple", chordVariants, updateVariant }) {
  const [buildMode, setBuildMode] = useState(initialBuildMode);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding:"24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      <SectionHeader title="🎵 Build a Song"
        sub="Build chords and strumming patterns together." />

      <ModeTabs options={[["simple","🎸 Simple"],["advanced","⚡ Advanced"]]}
        value={buildMode} onChange={setBuildMode} />

      {buildMode === "simple" && <SimpleBuildSong audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />}
      {buildMode === "advanced" && <AdvancedBuildSong audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />}
    </div>
  );
}

// ─── SIMPLE BUILD A SONG ─────────────────────────────────────────────────────
function SimpleBuildSong({ audio, chordVariants, updateVariant }) {
  const { init, playChordClick, playChordStrum } = audio;
  const [songChords, setSongChords] = useState([]);
  const [strumActive, setStrumActive] = useState(defaultBuild(8).concat(Array(8).fill(false)));
  const [hasSecondRow, setHasSecondRow] = useState(false);
  const [row1Size, setRow1Size] = useState(8);
  const [row2Size, setRow2Size] = useState(8);
  const [strumPatternBtn, setStrumPatternBtn] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(60);
  const [beatsPerChord, setBeatsPerChord] = useState(2);
  const [chordIndex, setChordIndex] = useState(0);
  const [beatCount, setBeatCount] = useState(0);
  const [currentStrum, setCurrentStrum] = useState(-1);
  const [loadedName, setLoadedName] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [savedPatterns, setSavedPatterns] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem("ntc_strum")||"[]"); } catch{ return []; }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [savePrompt, setSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");

  const intervalRef = useRef(null);
  const bpmRef = useRef(bpm);
  const bpcRef = useRef(beatsPerChord);
  const chordsRef = useRef(songChords);
  const strumRef = useRef(strumActive);
  const chordIdxRef = useRef(0);
  const chordBeatRef = useRef(0);
  const strumBeatRef = useRef(-1);
  const firstTickRef = useRef(true);
  const totalStrumRef = useRef(8);
  const row1SizeRef = useRef(8);
  const row2SizeRef = useRef(8);
  const hasSecondRowRef = useRef(false);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ bpcRef.current=beatsPerChord; },[beatsPerChord]);
  useEffect(()=>{ chordsRef.current=songChords; },[songChords]);
  useEffect(()=>{ strumRef.current=strumActive; },[strumActive]);
  useEffect(()=>{
    row1SizeRef.current=row1Size; row2SizeRef.current=row2Size;
    hasSecondRowRef.current=hasSecondRow;
    totalStrumRef.current=hasSecondRow?row1Size+row2Size:row1Size;
  },[row1Size,row2Size,hasSecondRow]);

  // Load from URL on mount
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("strum");
    if(encoded){
      const d = decodeStrumDrill(encoded);
      if(d){
        setSongChords(d.songChords); setStrumActive(d.strumActive);
        setHasSecondRow(d.hasSecondRow); setRow1Size(d.row1Size); setRow2Size(d.row2Size);
        setBpm(d.bpm); setBeatsPerChord(d.beatsPerChord);
        setLoadedName(d.name); setSaveName(d.name);
        setPickerOpen(false);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  // eslint-disable-next-line
  },[]);

  const tick = useCallback(()=>{
    const chords=chordsRef.current;
    const bpc=bpcRef.current;
    const r1=row1SizeRef.current, r2=row2SizeRef.current, has2=hasSecondRowRef.current;
    const totalS=has2?r1+r2:r1;
    const nextRaw=(strumBeatRef.current+1)%totalS;
    strumBeatRef.current=nextRaw;
    // Map nextRaw to strumActive index (row2 starts at index 8)
    const strumIdx = nextRaw < r1 ? nextRaw : 8 + (nextRaw - r1);
    setCurrentStrum(strumIdx);
    if(nextRaw===0 && !firstTickRef.current){
      const nextChordBeat=(chordBeatRef.current+1)%bpc;
      chordBeatRef.current=nextChordBeat;
      setBeatCount(nextChordBeat);
      if(nextChordBeat===0 && chords.length>0){
        const nextChord=(chordIdxRef.current+1)%chords.length;
        chordIdxRef.current=nextChord; setChordIndex(nextChord);
      }
    }
    firstTickRef.current=false;
    if(nextRaw%4===0) playChordClick(nextRaw===0);
    const isDown=strumIdx%2===0;
    if(strumRef.current[strumIdx]){
      const currentChord=chordsRef.current[chordIdxRef.current];
      if(currentChord) playChordStrum(getAudioKey(currentChord, chordVariants), isDown);
    }
  },[playChordClick,playChordStrum,chordVariants]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    strumBeatRef.current=-1; chordIdxRef.current=0; chordBeatRef.current=0;
    firstTickRef.current=true;
    setChordIndex(0); setBeatCount(0); setCurrentStrum(-1);
    const ms=(60/bpmRef.current/4)*1000;
    intervalRef.current=setInterval(tick,ms); tick();
  },[tick]);

  const stopMetronome = useCallback(()=>{
    clearInterval(intervalRef.current); intervalRef.current=null;
    setCurrentStrum(-1); setChordIndex(0); setBeatCount(0);
    strumBeatRef.current=-1; chordIdxRef.current=0;
  },[]);

  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[bpm,beatsPerChord,hasSecondRow,row1Size,row2Size]);
  useEffect(()=>()=>clearInterval(intervalRef.current),[]);

  const doSave = () => {
    if(!saveName.trim()) return;
    const pattern = { id:Date.now(), name:saveName.trim(),
      strumActive, hasSecondRow, row1Size, row2Size,
      songChords, bpm, beatsPerChord, savedAt:new Date().toLocaleDateString() };
    const updated = [...savedPatterns, pattern];
    setSavedPatterns(updated);
    localStorage.setItem("ntc_strum", JSON.stringify(updated));
    setSavePrompt(false); setSaveName(""); setShowSaved(true);
  };

  const doShare = (p) => {
    try {
      const encoded = encodeStrumDrill(p.name, p.strumActive, p.hasSecondRow, p.row1Size||8, p.row2Size||8, p.songChords, p.bpm, p.beatsPerChord);
      const url = `${window.location.origin}${window.location.pathname}?strum=${encoded}`;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(url)
          .then(()=>alert(`✅ Link copied!\n\nShare "${p.name}" with your members.`))
          .catch(()=>prompt("Copy this link:", url));
      } else { prompt("Copy this link:", url); }
    } catch(e) { alert("Couldn't generate link."); }
  };

  const canPlay = songChords.length>=1;
  const nextChordIndex = songChords.length>0?(chordIndex+1)%songChords.length:0;
  const isLastBeat = isPlaying&&beatsPerChord>1&&beatCount===beatsPerChord-1;

  const handleTogglePlay = async()=>{
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    else if(canPlay){await init();startMetronome();setIsPlaying(true);}
  };

  const cycleSize = (cur) => cur===8?4:cur===4?6:8;
  const sizeLabel = (n) => n===6?"Triplet":n===4?"4":"8";

  return (
    <>
      {/* ── SHARED LINK VIEW ─────────────────────────────── */}
      {!pickerOpen && (
        <>
          {/* Title */}
          {loadedName && (
            <div style={{ width:"100%", textAlign:"center", marginBottom:16 }}>
              <div style={{ fontSize:22, fontWeight:900, color:"#fff", letterSpacing:0.3,
                textShadow:"0 2px 8px rgba(0,0,0,0.5)" }}>{loadedName}</div>
            </div>
          )}

          {/* Chord carousel */}
          {songChords.length>=1 && (
            <ChordGrid chords={songChords} chordIndex={chordIndex} nextChordIndex={nextChordIndex}
              isPlaying={isPlaying} accentColor="#FFBE0B" isLastBeat={isLastBeat}
              bpm={bpm} beatsPerChord={beatsPerChord}
              chordVariants={chordVariants} updateVariant={updateVariant} />
          )}

          {/* Beat count dots */}
          {songChords.length>=1 && beatsPerChord>1 && (
            <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:16 }}>
              {Array(beatsPerChord).fill(null).map((_,i)=>(
                <div key={i} style={{ width:14, height:14, borderRadius:"50%",
                  background:isPlaying&&beatCount===i?"#FFBE0B":i===0?"#2a1f00":"#111",
                  border:`1px solid ${i===0?"#f5a62344":"#2a1f00"}`,
                  boxShadow:isPlaying&&beatCount===i?"0 0 8px rgba(255,190,11,0.7)":"none",
                  transition:"background 0.05s" }} />
              ))}
            </div>
          )}

          {/* Strum pattern */}
          <div style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a",
            borderRadius:20, padding:"16px", marginBottom:16 }}>
            <div style={{ fontSize:9, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:12 }}>STRUMMING PATTERN</div>
            <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap", marginBottom: hasSecondRow ? 10 : 0 }}>
              {Array(row1Size).fill(null).map((_,i)=>(
                <BuildBlock key={i} dir={DIRS16[i%8]} active={strumActive[i]} beat={currentStrum===i&&isPlaying} onClick={()=>{}} />
              ))}
            </div>
            {hasSecondRow && (
              <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap", marginTop:8 }}>
                {Array(row2Size).fill(null).map((_,i)=>(
                  <BuildBlock key={i+8} dir={DIRS16[i%8]} active={strumActive[i+8]} beat={currentStrum===i+8&&isPlaying} onClick={()=>{}} />
                ))}
              </div>
            )}
          </div>

          {/* BPM + Play */}
          <div style={{ width:"100%", background:"#111", border:"1px solid #2a2a2a",
            borderRadius:14, padding:"14px", marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:12, fontWeight:700, color:"#888" }}>BPM</span>
              <span style={{ fontSize:14, fontWeight:900, color:"#FFBE0B" }}>{bpm}</span>
            </div>
            <input type="range" min={40} max={160} value={bpm}
              onChange={e=>setBpm(Number(e.target.value))}
              style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
            <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:10 }}>
              {[60,80,100,120].map(b=>(
                <button key={b} onClick={()=>setBpm(b)} style={{
                  flex:1, padding:"5px 0", borderRadius:8,
                  border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
                  background:bpm===b?"rgba(255,190,11,0.15)":"#0a0a0a",
                  color:bpm===b?"#FFBE0B":"#555", fontSize:11, fontWeight:700, cursor:"pointer" }}>{b}</button>
              ))}
            </div>
            <button onClick={handleTogglePlay} disabled={!canPlay} style={{
              width:"100%", padding:"13px", borderRadius:12, border:"none",
              background:!canPlay?"#111":isPlaying?"linear-gradient(135deg,#c0392b,#e74c3c)":"linear-gradient(135deg,#FFD60A,#F77F00)",
              color:!canPlay?"#333":isPlaying?"#fff":"#111",
              fontSize:17, fontWeight:900, cursor:canPlay?"pointer":"not-allowed",
              boxShadow:!canPlay?"none":isPlaying?"0 4px 16px rgba(231,76,60,0.4)":"0 4px 24px rgba(255,214,10,0.4)",
            }}>{!canPlay?"Select a chord to start":isPlaying?"⏹ Stop":"▶ Play"}</button>
          </div>

          {/* Save / Load */}
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <button onClick={()=>setSavePrompt(p=>!p)} style={{
              flex:1, padding:"10px", borderRadius:12,
              border:"1px solid #FFBE0B44", background:"rgba(255,190,11,0.07)",
              color:"#FFBE0B", fontSize:13, fontWeight:700, cursor:"pointer" }}>💾 Save</button>
            <button onClick={()=>setShowSaved(s=>!s)} style={{
              flex:1, padding:"10px", borderRadius:12,
              border:"1px solid #2a2a2a", background:"#111",
              color:"#888", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              📂 My Patterns ({savedPatterns.length})
            </button>
          </div>

          {savePrompt && (
            <div style={{ marginBottom:10, background:"#111", border:"1px solid #FFBE0B33",
              borderRadius:14, padding:"14px" }}>
              <div style={{ fontSize:12, color:"#888", marginBottom:8, textAlign:"center" }}>Name this pattern</div>
              <div style={{ display:"flex", gap:8 }}>
                <input autoFocus value={saveName} onChange={e=>setSaveName(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&doSave()}
                  placeholder="e.g. Verse loop..."
                  style={{ flex:1, padding:"9px 12px", borderRadius:10,
                    border:"1px solid #333", background:"#0a0a0a",
                    color:"#fff", fontSize:13, outline:"none" }} />
                <button onClick={doSave} style={{ padding:"9px 16px", borderRadius:10, border:"none",
                  background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                  color:"#111", fontSize:13, fontWeight:800, cursor:"pointer" }}>Save</button>
                <button onClick={()=>{setSavePrompt(false);setSaveName("");}} style={{
                  padding:"9px 12px", borderRadius:10, border:"1px solid #333",
                  background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>✕</button>
              </div>
            </div>
          )}

          {showSaved && (
            <div style={{ marginBottom:10, display:"flex", flexDirection:"column", gap:6 }}>
              {savedPatterns.length===0 && (
                <div style={{ textAlign:"center", color:"#444", fontSize:13, padding:"14px 0" }}>
                  No saved patterns yet
                </div>
              )}
              {savedPatterns.map(p=>(
                <div key={p.id} style={{ background:"#111", border:"1px solid #2a2a2a",
                  borderRadius:12, padding:"10px 14px",
                  display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:800, color:"#fff",
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</div>
                    <div style={{ fontSize:11, color:"#555", marginTop:2 }}>{p.bpm} BPM · {p.savedAt}</div>
                  </div>
                  <div style={{ display:"flex", gap:6, marginLeft:10 }}>
                    <button onClick={()=>{
                      if(isPlaying){stopMetronome();setIsPlaying(false);}
                      setSongChords(p.songChords||[]); setStrumActive(p.strumActive);
                      setHasSecondRow(p.hasSecondRow||false);
                      setRow1Size(p.row1Size||8); setRow2Size(p.row2Size||8);
                      setBpm(p.bpm); setBeatsPerChord(p.beatsPerChord||2);
                      setLoadedName(p.name); setShowSaved(false);
                    }} style={{ padding:"6px 12px", borderRadius:8, border:"none",
                      background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                      color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                    <button onClick={()=>doShare(p)} style={{ padding:"6px 10px", borderRadius:8,
                      border:"1px solid #333", background:"transparent",
                      color:"#6b9fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>🔗</button>
                    <button onClick={()=>{
                      const updated=savedPatterns.filter(x=>x.id!==p.id);
                      setSavedPatterns(updated);
                      localStorage.setItem("ntc_strum", JSON.stringify(updated));
                    }} style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #333",
                      background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Show builder link */}
          <button onClick={()=>setPickerOpen(true)} style={{
            width:"100%", padding:"8px", marginTop:4,
            borderRadius:10, border:"1px solid #2a2a2a",
            background:"transparent", color:"#555",
            fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:1,
          }}>▼ SHOW BUILDER</button>
        </>
      )}

      {/* ── FULL BUILDER VIEW ────────────────────────────── */}
      {pickerOpen && (
        <>
          {loadedName && (
            <div style={{ width:"100%", textAlign:"center", marginBottom:4 }}>
              <div style={{ fontSize:18, fontWeight:900, color:"#fff", letterSpacing:0.3,
                textShadow:"0 2px 8px rgba(0,0,0,0.5)", marginBottom:2 }}>{loadedName}</div>
            </div>
          )}

          <ChordPickerPanel customChords={songChords} setCustomChords={setSongChords}
            maxChords={10} accentColor="#FFBE0B" isPlaying={isPlaying}
            stopMetronome={stopMetronome} setIsPlaying={setIsPlaying}
            setChordIndex={setChordIndex} setBeatCount={setBeatCount}
            beatRef={chordIdxRef} chordRef={chordIdxRef}
            chordVariants={chordVariants} updateVariant={updateVariant}
            allowDuplicates={true} />

          <button onClick={()=>setPickerOpen(false)} style={{
            width:"100%", marginBottom:12, padding:"8px",
            borderRadius:10, border:"1px solid #2a2a2a",
            background:"transparent", color:"#555",
            fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:1,
          }}>▲ HIDE BUILDER</button>

          {songChords.length>=1 && (
            <>
              <ChordGrid chords={songChords} chordIndex={chordIndex} nextChordIndex={nextChordIndex}
                isPlaying={isPlaying} accentColor="#FFBE0B" isLastBeat={isLastBeat}
                bpm={bpm} beatsPerChord={beatsPerChord}
                chordVariants={chordVariants} updateVariant={updateVariant} />
              <div style={{ width:"100%", marginBottom:20 }}>
                <div style={{ fontSize:11, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:10 }}>BEATS PER CHORD</div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:12 }}>
                  {BEATS_OPTIONS.map(b=>(
                    <button key={b} onClick={()=>{ setBeatsPerChord(b); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
                      padding:"9px 26px", borderRadius:10,
                      border: beatsPerChord===b ? "2px solid #FFBE0B" : "2px solid #2a2210",
                      background: beatsPerChord===b ? "rgba(255,190,11,0.12)" : "#111",
                      color: beatsPerChord===b ? "#FFBE0B" : "#555",
                      fontSize:15, fontWeight:800, cursor:"pointer",
                    }}>{b}</button>
                  ))}
                </div>
                <div style={{ display:"flex", justifyContent:"center", gap:8 }}>
                  {Array(beatsPerChord).fill(null).map((_,i)=>(
                    <div key={i} style={{ width:14, height:14, borderRadius:"50%",
                      background:isPlaying&&beatCount===i?"#FFBE0B":i===0?"#2a1f00":"#111",
                      border:`1px solid ${i===0?"#f5a62344":"#2a1f00"}`,
                      boxShadow:isPlaying&&beatCount===i?"0 0 8px rgba(255,190,11,0.7)":"none",
                      transition:"background 0.05s" }} />
                  ))}
                </div>
              </div>
            </>
          )}

          <div data-song-panel style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a",
            borderRadius:20, padding:"18px 16px", marginBottom:20 }}>
            <div style={{ fontSize:11, color:"#888", letterSpacing:2, textAlign:"center", marginBottom:4 }}>STRUM BUILDER</div>
            {loadedName && (
              <div style={{ fontSize:18, fontWeight:900, color:"#fff", textAlign:"center",
                marginBottom:12, letterSpacing:0.3, textShadow:"0 2px 8px rgba(0,0,0,0.5)" }}>
                {loadedName}
              </div>
            )}
            {!loadedName && <div style={{ marginBottom:12 }} />}

            <div style={{ background:"#111", border:"1px solid #2a2a2a", borderRadius:14, padding:"12px 14px", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#888" }}>BPM</span>
                <span style={{ fontSize:14, fontWeight:900, color:"#FFBE0B" }}>{bpm}</span>
              </div>
              <input type="range" min={40} max={160} value={bpm}
                onChange={e=>setBpm(Number(e.target.value))}
                style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
              <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:10 }}>
                {[60,80,100,120].map(b=>(
                  <button key={b} onClick={()=>setBpm(b)} style={{
                    flex:1, padding:"5px 0", borderRadius:8,
                    border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
                    background:bpm===b?"rgba(255,190,11,0.15)":"#0a0a0a",
                    color:bpm===b?"#FFBE0B":"#555", fontSize:11, fontWeight:700, cursor:"pointer" }}>{b}</button>
                ))}
              </div>
              <button onClick={handleTogglePlay} disabled={!canPlay} style={{
                width:"100%", padding:"11px", borderRadius:12, border:"none",
                background:!canPlay?"#111":isPlaying?"linear-gradient(135deg,#c0392b,#e74c3c)":"linear-gradient(135deg,#1a6b3c,#27ae60)",
                color:!canPlay?"#333":"#fff", fontSize:15, fontWeight:800,
                cursor:canPlay?"pointer":"not-allowed", transition:"all 0.15s",
                boxShadow:!canPlay?"none":isPlaying?"0 4px 16px rgba(231,76,60,0.4)":"0 4px 16px rgba(39,174,96,0.4)",
              }}>{!canPlay?"Select a chord to start":isPlaying?"⏹ Stop":"▶ Start"}</button>
            </div>

            <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginBottom:16 }}>
              {[1,2,3].map(n=>(
                <PatternBtn key={n} label={`Pattern ${n}`} active={strumPatternBtn===n}
                  onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                    const pat=STRUM_PATTERNS[n].active;
                    setStrumActive(prev=>{ const next=[...prev]; for(let i=0;i<8;i++) next[i]=pat[i]; return next; });
                    setHasSecondRow(false); setRow1Size(8); setStrumPatternBtn(n); }} />
              ))}
              <PatternBtn label="🎲 Random" active={strumPatternBtn==="random"} accent
                onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                  setStrumActive(generateRandomPattern().active); setStrumPatternBtn("random"); setHasSecondRow(false); setRow1Size(8); }} />
            </div>

            <div style={{ marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:5 }}>
                <div style={{ fontSize:10, color:"#444", letterSpacing:1 }}>ROW 1</div>
                <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                  const ns=cycleSize(row1Size); setRow1Size(ns);
                  setStrumActive(p=>{ const n=[...p]; for(let i=ns;i<8;i++) n[i]=false; return n; });
                  setStrumPatternBtn(null);
                }} style={{ padding:"4px 12px", borderRadius:8, border:"1px solid #333",
                  background:"#1a1a1a", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                  {sizeLabel(row1Size)} ↻
                </button>
              </div>
              <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap" }}>
                {Array(row1Size).fill(null).map((_,i)=>(
                  <BuildBlock key={i} dir={DIRS16[i%8]} active={strumActive[i]} beat={currentStrum===i&&isPlaying}
                    onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                      setStrumActive(p=>p.map((v,idx)=>idx===i?!v:v)); setStrumPatternBtn(null); }} />
                ))}
              </div>
            </div>

            {hasSecondRow && (
              <div style={{ marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:5 }}>
                  <div style={{ fontSize:10, color:"#444", letterSpacing:1 }}>ROW 2</div>
                  <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                    const ns=cycleSize(row2Size); setRow2Size(ns);
                    setStrumActive(p=>{ const n=[...p]; for(let i=8+ns;i<16;i++) n[i]=false; return n; });
                    setStrumPatternBtn(null);
                  }} style={{ padding:"4px 12px", borderRadius:8, border:"1px solid #333",
                    background:"#1a1a1a", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                    {sizeLabel(row2Size)} ↻
                  </button>
                </div>
                <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap" }}>
                  {Array(row2Size).fill(null).map((_,i)=>(
                    <BuildBlock key={i+8} dir={DIRS16[i%8]} active={strumActive[i+8]} beat={currentStrum===i+8&&isPlaying}
                      onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                        setStrumActive(p=>p.map((v,idx)=>idx===i+8?!v:v)); setStrumPatternBtn(null); }} />
                  ))}
                </div>
              </div>
            )}

            <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:12, marginBottom:16, flexWrap:"wrap" }}>
              {!hasSecondRow
                ? <button onClick={()=>{ setHasSecondRow(true);
                    setStrumActive(p=>[...p.slice(0,8),...defaultBuild(8)]);
                    setRow2Size(8);
                    if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
                    padding:"8px 18px", borderRadius:10, border:"1px solid #FFBE0B",
                    background:"rgba(255,190,11,0.07)", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Add Row</button>
                : <button onClick={()=>{ setHasSecondRow(false);
                    setStrumActive(p=>[...p.slice(0,8),...Array(8).fill(false)]);
                    if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
                    padding:"8px 18px", borderRadius:10, border:"1px solid #2a2a2a",
                    background:"transparent", color:"#666", fontSize:12, cursor:"pointer" }}>− Remove Row</button>
              }
              <button onClick={()=>{ setStrumActive([...defaultBuild(8),...Array(8).fill(false)]); setStrumPatternBtn(null); setLoadedName(null); setSongChords([]); setPickerOpen(true); }} style={{
                padding:"8px 14px", borderRadius:10, border:"1px solid #2a2a2a",
                background:"transparent", color:"#444", fontSize:12, cursor:"pointer" }}>Reset</button>
              <button onClick={()=>setSavePrompt(p=>!p)} style={{
                padding:"8px 14px", borderRadius:10, border:"1px solid #FFBE0B44",
                background:"rgba(255,190,11,0.07)", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>💾 Save</button>
              <button onClick={()=>setShowSaved(s=>!s)} style={{
                padding:"8px 14px", borderRadius:10, border:"1px solid #2a2a2a",
                background:"#111", color:"#888", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                📂 My Patterns ({savedPatterns.length})
              </button>
            </div>

            {savePrompt && (
              <div style={{ marginBottom:14, background:"#111", border:"1px solid #FFBE0B33",
                borderRadius:14, padding:"14px" }}>
                <div style={{ fontSize:12, color:"#888", marginBottom:8, textAlign:"center" }}>Name this pattern</div>
                <div style={{ display:"flex", gap:8 }}>
                  <input autoFocus value={saveName} onChange={e=>setSaveName(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&doSave()}
                    placeholder="e.g. Verse loop, Chorus..."
                    style={{ flex:1, padding:"9px 12px", borderRadius:10,
                      border:"1px solid #333", background:"#0a0a0a",
                      color:"#fff", fontSize:13, outline:"none" }} />
                  <button onClick={doSave} style={{ padding:"9px 16px", borderRadius:10, border:"none",
                    background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                    color:"#111", fontSize:13, fontWeight:800, cursor:"pointer" }}>Save</button>
                  <button onClick={()=>{setSavePrompt(false);setSaveName("");}} style={{
                    padding:"9px 12px", borderRadius:10, border:"1px solid #333",
                    background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>✕</button>
                </div>
              </div>
            )}

            {showSaved && (
              <div style={{ marginBottom:14, display:"flex", flexDirection:"column", gap:6 }}>
                {savedPatterns.length===0 && (
                  <div style={{ textAlign:"center", color:"#444", fontSize:13, padding:"14px 0" }}>
                    No saved patterns yet — build something and hit 💾
                  </div>
                )}
                {savedPatterns.map(p=>(
                  <div key={p.id} style={{ background:"#111", border:"1px solid #2a2a2a",
                    borderRadius:12, padding:"10px 14px",
                    display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:800, color:"#fff",
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</div>
                      <div style={{ fontSize:11, color:"#555", marginTop:2 }}>
                        {p.bpm} BPM · {p.hasSecondRow?"2 rows":"1 row"} · {p.savedAt}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6, marginLeft:10 }}>
                      <button onClick={()=>{
                        if(isPlaying){stopMetronome();setIsPlaying(false);}
                        setSongChords(p.songChords||[]); setStrumActive(p.strumActive);
                        setHasSecondRow(p.hasSecondRow||false);
                        setRow1Size(p.row1Size||8); setRow2Size(p.row2Size||8);
                        setBpm(p.bpm); setBeatsPerChord(p.beatsPerChord||2);
                        setLoadedName(p.name); setPickerOpen(false); setShowSaved(false);
                      }} style={{ padding:"6px 12px", borderRadius:8, border:"none",
                        background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                        color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                      <button onClick={()=>doShare(p)} style={{ padding:"6px 10px", borderRadius:8,
                        border:"1px solid #333", background:"transparent",
                        color:"#6b9fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>🔗 Share</button>
                      <button onClick={()=>{
                        const updated=savedPatterns.filter(x=>x.id!==p.id);
                        setSavedPatterns(updated);
                        localStorage.setItem("ntc_strum", JSON.stringify(updated));
                      }} style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #333",
                        background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ textAlign:"center", paddingTop:24, paddingBottom:8, color:"#333", fontSize:11 }}>
            © {new Date().getFullYear()} No Theory Club · All rights reserved.
          </div>
        </>
      )}
    </>
  );
}


// ─── ADVANCED BUILD A SONG ───────────────────────────────────────────────────
function AdvancedBuildSong({ audio, chordVariants, updateVariant }) {
  const { init, playChordClick, playChordStrum } = audio;
  const [rowSizes, setRowSizes] = useState([8]);
  const [rowRepeats, setRowRepeats] = useState([1]); // repeat count per row
  const [strumActive, setStrumActive] = useState(()=>{
    const arr = defaultBuild(8);
    while(arr.length < 80) arr.push(false);
    return arr;
  });
  const [blockChords, setBlockChords] = useState(Array(80).fill(null));
  const [assignMode, setAssignMode] = useState(false);
  const [assignChord, setAssignChord] = useState("G");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [chordPickerOpen, setChordPickerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countIn, setCountIn] = useState(0);
  const [countInBeat, setCountInBeat] = useState(-1);
  const [bpm, setBpm] = useState(60);
  const [currentStrum, setCurrentStrum] = useState(-1);
  const [currentFlatIdx, setCurrentFlatIdx] = useState(-1);
  const [currentChordLabel, setCurrentChordLabel] = useState(null);
  const [muteMetronome, setMuteMetronome] = useState(false);
  const [capo, setCapo] = useState(0);
  const [loadedPatternName, setLoadedPatternName] = useState(null);
  const rowRefsRef = useRef([]);
  const currentPlayingRowRef = useRef(-1);
  const [savedPatterns, setSavedPatterns] = useState(()=>{
    try { return JSON.parse(localStorage.getItem("ntc_patterns")||"[]"); } catch{ return []; }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [savePrompt, setSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");

  const intervalRef = useRef(null);
  const bpmRef = useRef(bpm);
  const strumRef = useRef(strumActive);
  const blockChordsRef = useRef(blockChords);
  const strumBeatRef = useRef(-1);
  const totalBlocksRef = useRef(8);
  const rowSizesRef = useRef(rowSizes);
  const rowRepeatsRef = useRef(rowRepeats);
  const currentChordRef = useRef(null);
  const muteRef = useRef(muteMetronome);
  const capoRef = useRef(capo);

  // Compute flat block offsets from rowSizes
  const getRowOffsets = (sizes) => {
    const offsets = [];
    let offset = 0;
    for(const s of sizes){ offsets.push(offset); offset+=s; }
    return offsets;
  };
  const totalBlocks = rowSizes.reduce((a,b,i)=>a+b*(rowRepeats[i]||1),0);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ strumRef.current=strumActive; },[strumActive]);
  useEffect(()=>{ blockChordsRef.current=blockChords; },[blockChords]);
  useEffect(()=>{ rowSizesRef.current=rowSizes; rowRepeatsRef.current=rowRepeats;
    totalBlocksRef.current=rowSizes.reduce((a,b,i)=>a+b*(rowRepeats[i]||1),0); },[rowSizes,rowRepeats]);
  useEffect(()=>{ muteRef.current=muteMetronome; },[muteMetronome]);
  useEffect(()=>{ capoRef.current=capo; },[capo]);

  const tick = useCallback(()=>{
    const total=totalBlocksRef.current;
    const next=(strumBeatRef.current+1)%total;
    strumBeatRef.current=next;
    setCurrentStrum(next);

    // Build flat sequence respecting repeats to find actual block index
    const sizes=rowSizesRef.current;
    const repeats=rowRepeatsRef.current;
    let flatIdx=0, blockIdx=next;
    for(let r=0;r<sizes.length;r++){
      const rowTotal=sizes[r]*(repeats[r]||1);
      if(blockIdx<rowTotal){
        // blockIdx within this row's repeated sequence
        const posInRow=blockIdx%sizes[r];
        // offset in strumActive/blockChords array
        let offset=0;
        for(let j=0;j<r;j++) offset+=sizes[j];
        flatIdx=offset+posInRow;
        break;
      }
      blockIdx-=rowTotal;
    }

    const assignedChord=blockChordsRef.current[flatIdx];
    if(assignedChord){ currentChordRef.current=assignedChord; setCurrentChordLabel(assignedChord); }
    setCurrentFlatIdx(flatIdx);

    // Auto-scroll: track which row is playing, scroll one row at a time
    if(rowSizesRef.current.length > 4) {
      const sizes = rowSizesRef.current;
      let offset = 0;
      let playingRow = 0;
      for(let r = 0; r < sizes.length; r++) {
        if(flatIdx >= offset && flatIdx < offset + sizes[r]) { playingRow = r; break; }
        offset += sizes[r];
      }

      if(playingRow !== currentPlayingRowRef.current) {
        const prevRow = currentPlayingRowRef.current;
        currentPlayingRowRef.current = playingRow;

        if(playingRow === 0 && prevRow > 0) {
          // Loop back — scroll to show top of song builder panel
          const panelEl = rowRefsRef.current[0]?.closest?.('[data-song-panel]') || rowRefsRef.current[0]?.parentElement?.parentElement;
          if(panelEl) {
            const panelTop = panelEl.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: panelTop, behavior: "smooth" });
          }
        } else if(playingRow > 0) {
          // Scroll down by one row height
          const prevEl = rowRefsRef.current[prevRow >= 0 ? prevRow : 0];
          const nextEl = rowRefsRef.current[playingRow];
          if(prevEl && nextEl) {
            const rowHeight = nextEl.getBoundingClientRect().top - prevEl.getBoundingClientRect().top;
            window.scrollBy({ top: rowHeight, behavior: "smooth" });
          }
        }
      }
    }
    if(!muteRef.current && next%4===0) playChordClick(next===0);
    const isDown=next%2===0;
    if(strumRef.current[flatIdx] && currentChordRef.current) playChordStrum(getAudioKey(currentChordRef.current, chordVariants), isDown, capoRef.current);
  },[playChordClick,playChordStrum]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    strumBeatRef.current=-1; currentChordRef.current=null;
    // Don't reset currentChordLabel here to avoid layout jump
    const ms=(60/bpmRef.current/4)*1000;
    intervalRef.current=setInterval(tick,ms);
    tick();
  },[tick]);

  const stopMetronome = useCallback(()=>{
    clearInterval(intervalRef.current); intervalRef.current=null;
    setCurrentStrum(-1); strumBeatRef.current=-1;
    setCurrentFlatIdx(-1);
    setCurrentChordLabel(null); currentChordRef.current=null;
    currentPlayingRowRef.current=-1;
  },[]);

  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[bpm,rowSizes,rowRepeats]);
  useEffect(()=>()=>clearInterval(intervalRef.current),[]);

  const handleSave = () => {
    if(!saveName.trim()) return;
    if(savedPatterns.length >= 20) { alert("You've reached the 20 pattern limit — delete one first!"); return; }
    const pattern = {
      id: Date.now(),
      name: saveName.trim(),
      rowSizes, rowRepeats, strumActive, blockChords, bpm, capo,
      savedAt: new Date().toLocaleDateString(),
    };
    const updated = [...savedPatterns, pattern];
    setSavedPatterns(updated);
    localStorage.setItem("ntc_patterns", JSON.stringify(updated));
    setSavePrompt(false);
    setSaveName("");
    setShowSaved(true);
  };

  const handleLoad = (p) => {
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    setRowSizes(p.rowSizes);
    setRowRepeats(p.rowRepeats||p.rowSizes.map(()=>1));
    setStrumActive(p.strumActive);
    setBlockChords(p.blockChords);
    setBpm(p.bpm);
    setCapo(p.capo||0);
    setLoadedPatternName(p.name);
    setShowSaved(false);
  };

  const handleShare = (p) => {
    try {
      const sparse = {
        n: p.name,
        rs: p.rowSizes,
        rr: p.rowRepeats||p.rowSizes.map(()=>1),
        sa: p.strumActive.reduce((acc,v,i)=>{ if(v) acc.push(i); return acc; }, []),
        bc: Object.fromEntries(p.blockChords.map((v,i)=>[i,v]).filter(([,v])=>v)),
        b: p.bpm,
        c: p.capo||0,
      };
      const encoded = btoa(JSON.stringify(sparse));
      const url = `${window.location.origin}${window.location.pathname}?pattern=${encoded}`;
      navigator.clipboard.writeText(url).then(()=>{
        alert(`✅ Link copied!\n\nShare it with anyone — they can open it and load "${p.name}" directly.`);
      }).catch(()=>{ prompt("Copy this link:", url); });
    } catch(e) { alert("Couldn't generate share link."); }
  };

  // On mount — check if URL has a shared pattern
  useEffect(()=>{
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get("pattern");
      if(!encoded) return;
      const d = JSON.parse(atob(encoded));
      setRowSizes(d.rs||[8]);
      setRowRepeats(d.rr||d.rs?.map(()=>1)||[1]);
      // Support both sparse (array of indices) and legacy (full array)
      if(Array.isArray(d.sa) && (d.sa.length===0 || typeof d.sa[0]==="number")) {
        const sa = Array(80).fill(false);
        d.sa.forEach(i=>{ sa[i]=true; });
        setStrumActive(sa);
      } else {
        setStrumActive(d.sa||Array(80).fill(false));
      }
      // Support both sparse (object) and legacy (array)
      if(d.bc && !Array.isArray(d.bc)) {
        const bc = Array(80).fill(null);
        Object.entries(d.bc).forEach(([i,v])=>{ bc[Number(i)]=v; });
        setBlockChords(bc);
      } else {
        setBlockChords(d.bc||Array(80).fill(null));
      }
      setBpm(d.b||60);
      setCapo(d.c||0);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(()=>{ setSaveName(d.n||"Shared Pattern"); setSavePrompt(true); setLoadedPatternName(d.n||"Shared Pattern"); }, 500);
    } catch(e) {}
  }, []);

  const handleDelete = (id) => {
    const updated = savedPatterns.filter(p=>p.id!==id);
    setSavedPatterns(updated);
    localStorage.setItem("ntc_patterns", JSON.stringify(updated));
  };

  const handleTogglePlay = async()=>{
    if(isPlaying || countIn>0){
      stopMetronome();
      setIsPlaying(false);
      setCountIn(0);
      setCountInBeat(-1);
    } else {
      await init();
      const ms = (60/bpm)*1000;
      let beat = 4;
      let beatIdx = 0;
      setCountIn(beat);
      setCountInBeat(beatIdx);
      playChordClick(true);
      const countInterval = setInterval(()=>{
        beat--;
        beatIdx += 2;
        if(beat <= 0){
          clearInterval(countInterval);
          setCountIn(0);
          setCountInBeat(-1);
          startMetronome();
          setIsPlaying(true);
        } else {
          setCountIn(beat);
          setCountInBeat(beatIdx % 8);
          playChordClick(false);
        }
      }, ms);
    }
  };

  const handleBlockClick = (i)=>{
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    if(assignMode){
      setBlockChords(p=>p.map((v,idx)=>idx===i?(v===assignChord?null:assignChord):v));
    } else {
      setStrumActive(p=>p.map((v,idx)=>idx===i?!v:v));
    }
  };

  // Find next chord after current position
  const assignedChords = [...new Set(blockChords.filter(Boolean))];
  const nextChordLabel = (() => {
    if(!isPlaying || currentStrum < 0) return null;
    for(let i=1; i<=totalBlocks; i++){
      const idx=(currentStrum+i)%totalBlocks;
      if(blockChords[idx] && blockChords[idx]!==currentChordLabel) return blockChords[idx];
    }
    return null;
  })();
  const prevChordLabel = (() => {
    if(!isPlaying || currentStrum < 0) return null;
    for(let i=1; i<=totalBlocks; i++){
      const idx=(currentStrum-i+totalBlocks)%totalBlocks;
      if(blockChords[idx]) return blockChords[idx];
    }
    return null;
  })();

  return (
    <>
      <div data-song-panel style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a",
        borderRadius:20, padding:"18px 16px", marginBottom:20 }}>
        <div style={{ fontSize:11, color:"#888", letterSpacing:2, textAlign:"center", marginBottom:4 }}>SONG BUILDER</div>
        {loadedPatternName && (
          <div style={{ fontSize:18, fontWeight:900, color:"#fff", textAlign:"center",
            marginBottom:12, letterSpacing:0.3,
            textShadow:"0 2px 8px rgba(0,0,0,0.5)" }}>
            {loadedPatternName}
          </div>
        )}
        {!loadedPatternName && <div style={{ marginBottom:12 }} />}
        <div style={{ background:"#111", border:"1px solid #2a2a2a", borderRadius:14,
          padding:"12px 14px", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <span style={{ fontSize:12, fontWeight:700, color:"#888" }}>BPM</span>
            <span style={{ fontSize:14, fontWeight:900, color:"#FFBE0B" }}>{bpm}</span>
          </div>
          <input type="range" min={40} max={160} value={bpm}
            onChange={e=>setBpm(Number(e.target.value))}
            style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
          <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:10 }}>
            {[60,80,100,120].map(b=>(
              <button key={b} onClick={()=>setBpm(b)} style={{
                flex:1, padding:"5px 0", borderRadius:8,
                border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
                background:bpm===b?"rgba(255,190,11,0.15)":"#0a0a0a",
                color:bpm===b?"#FFBE0B":"#555", fontSize:11, fontWeight:700, cursor:"pointer" }}>{b}</button>
            ))}
          </div>
          <button onClick={handleTogglePlay} style={{
            width:"100%", padding:"11px", borderRadius:12, border:"none",
            background: countIn>0 ? "linear-gradient(135deg,#a06000,#c87800)"
              : isPlaying ? "linear-gradient(135deg,#c0392b,#e74c3c)"
              : "linear-gradient(135deg,#1a6b3c,#27ae60)",
            color:"#fff", fontSize: countIn>0 ? 22 : 15, fontWeight:800,
            cursor:"pointer", transition:"all 0.15s",
            boxShadow: countIn>0 ? "0 4px 16px rgba(255,190,11,0.3)"
              : isPlaying ? "0 4px 16px rgba(231,76,60,0.4)"
              : "0 4px 16px rgba(39,174,96,0.4)",
          }}>
            {countIn>0 ? countIn : isPlaying ? "⏹ Stop" : "▶ Start"}
          </button>
        </div>

        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:14, flexWrap:"wrap" }}>
          <button onClick={()=>setAssignMode(m=>!m)} style={{
            padding:"8px 16px", borderRadius:10,
            border: assignMode ? "2px solid #FFBE0B" : "1px solid #2a2a2a",
            background: assignMode ? "rgba(255,190,11,0.12)" : "#111",
            color: assignMode ? "#FFBE0B" : "#666",
            fontSize:12, fontWeight:700, cursor:"pointer",
          }}>{assignMode ? "🎸 Strumming" : "✏️ Assign Chords"}</button>

          <button onClick={()=>setMuteMetronome(m=>!m)} style={{
            padding:"8px 16px", borderRadius:10,
            border: muteMetronome ? "2px solid #e74c3c" : "1px solid #2a2a2a",
            background: muteMetronome ? "rgba(231,76,60,0.1)" : "#111",
            color: muteMetronome ? "#e74c3c" : "#666",
            fontSize:12, fontWeight:700, cursor:"pointer",
          }}>{muteMetronome ? "🔇 Muted" : "🔔 Click"}</button>

          {/* Capo */}
          <div style={{ display:"flex", alignItems:"center", gap:6,
            background:"#111", border:"1px solid #2a2a2a", borderRadius:10, padding:"6px 10px" }}>
            <span style={{ fontSize:11, color:"#555", fontWeight:700 }}>CAPO</span>
            <button onClick={()=>setCapo(c=>Math.max(0,c-1))} style={{
              width:22, height:22, borderRadius:6, border:"1px solid #333",
              background:"#1a1a1a", color:"#aaa", fontSize:14, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>−</button>
            <span style={{ fontSize:14, fontWeight:900, color: capo>0?"#FFBE0B":"#444", minWidth:14, textAlign:"center" }}>{capo}</span>
            <button onClick={()=>setCapo(c=>Math.min(7,c+1))} style={{
              width:22, height:22, borderRadius:6, border:"1px solid #333",
              background:"#1a1a1a", color:"#aaa", fontSize:14, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>+</button>
          </div>
        </div>

        {/* Chord picker — shows automatically when in assign mode */}
        {assignMode && (
          <>
            {/* Category filter buttons */}
            <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:8, flexWrap:"wrap" }}>
              {["all","7","sus","add","/"].map(cat=>(
                <button key={cat} onClick={()=>setCategoryFilter(cat)} style={{
                  padding:"5px 14px", borderRadius:8,
                  border: categoryFilter===cat ? "2px solid #FFBE0B" : "1px solid #2a2a2a",
                  background: categoryFilter===cat ? "rgba(255,190,11,0.15)" : "#111",
                  color: categoryFilter===cat ? "#FFBE0B" : "#555",
                  fontSize:12, fontWeight:800, cursor:"pointer", transition:"all 0.1s",
                }}>{cat==="all" ? "Basic" : cat}</button>
              ))}
            </div>

            {/* Chord grid — filtered by category */}
            <div style={{ background:"#111", border:"1px solid #2a2a2a", borderRadius:14,
              padding:"12px", marginBottom:8,
              display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
              {(categoryFilter==="all" ? ALL_CHORDS : CHORD_CATEGORIES[categoryFilter]||[]).map(c=>(
                <button key={c} onClick={()=>setAssignChord(c)} style={{
                  padding:"8px 4px", borderRadius:8, border:"none",
                  background: assignChord===c ? "linear-gradient(135deg,#FFBE0B,#F77F00)" : "#1c1c1c",
                  color: assignChord===c ? "#111" : "#888",
                  fontSize:11, fontWeight:800, cursor:"pointer",
                  boxShadow: assignChord===c ? "0 0 8px rgba(255,190,11,0.4)" : "none",
                  transition:"all 0.1s",
                }}>{c}</button>
              ))}
            </div>
            <div style={{ textAlign:"center", fontSize:11, color:"#555", marginBottom:10 }}>
              Tap a block to assign <span style={{ color:"#FFBE0B" }}>{assignChord}</span> · tap again to remove
            </div>
          </>
        )}

        {(() => {
          const offsets = getRowOffsets(rowSizes);
          return rowSizes.map((rowSize, rowIdx)=>{
            const offset = offsets[rowIdx];
            const cycleSize = rowSize===8 ? 4 : rowSize===4 ? 6 : 8;
            const sizeLabel = rowSize===6 ? "Triplet" : rowSize===4 ? "4" : "8";
            return (
              <div key={rowIdx} style={{ marginBottom:10 }}
                ref={el => { rowRefsRef.current[rowIdx] = el; }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:5 }}>
                  <div style={{ fontSize:10, color:"#444", letterSpacing:1 }}>ROW {rowIdx+1}</div>
                  <button onClick={()=>{
                    if(isPlaying){stopMetronome();setIsPlaying(false);}
                    setRowSizes(p=>p.map((s,i)=>i===rowIdx?cycleSize:s));
                  }} style={{
                    padding:"6px 14px", borderRadius:8, border:"1px solid #333",
                    background:"#1a1a1a", color:"#FFBE0B", fontSize:12,
                    fontWeight:700, cursor:"pointer", minWidth:48,
                  }}>{sizeLabel} ↻</button>
                  <button onClick={()=>{
                    if(isPlaying){stopMetronome();setIsPlaying(false);}
                    setRowRepeats(p=>p.map((r,i)=>i===rowIdx?(r>=4?1:r+1):r));
                  }} style={{
                    padding:"6px 14px", borderRadius:8, border:"1px solid #333",
                    background: (rowRepeats[rowIdx]||1)>1 ? "rgba(255,190,11,0.15)" : "#1a1a1a",
                    color: (rowRepeats[rowIdx]||1)>1 ? "#FFBE0B" : "#555",
                    fontSize:12, fontWeight:700, cursor:"pointer", minWidth:54,
                  }}>{rowRepeats[rowIdx]||1}× 🔁</button>
                </div>
                <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap" }}>
                  {Array(rowSize).fill(null).map((_,colIdx)=>{
                    const i = offset+colIdx;
                    const assignedChord=blockChords[i];
                    const isCountInGlow = countIn>0 && rowIdx===0 && colIdx===countInBeat;
                    return (
                      <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        {isCountInGlow
                          ? <div style={{ width:40, height:40, borderRadius:10,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              background:"rgba(200,30,30,0.35)", border:"2px solid rgba(220,50,50,0.6)",
                              boxShadow:"0 0 12px rgba(220,50,50,0.4)", transition:"all 0.05s" }}>
                              <span style={{ color:"#fff", fontWeight:900, fontSize:18 }}>{countIn}</span>
                            </div>
                          : <BuildBlock dir={DIRS16[colIdx%8]} active={strumActive[i]}
                              beat={currentFlatIdx===i&&isPlaying}
                              assigned={!!assignedChord} onClick={()=>handleBlockClick(i)} />
                        }
                        <div style={{ fontSize:20, fontWeight:900, height:22,
                          color: assignedChord ? "#FFBE0B" : "transparent",
                          textShadow: assignedChord ? "0 0 8px rgba(255,190,11,0.6)" : "none",
                          letterSpacing:0.3,
                        }}>{assignedChord||"·"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}

        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:12, flexWrap:"wrap" }}>
          {rowSizes.length<10 && <button onClick={()=>{ setRowSizes(p=>[...p,8]); setRowRepeats(p=>[...p,1]); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
            padding:"8px 16px", borderRadius:10, border:"1px dashed #FFBE0B",
            background:"rgba(255,190,11,0.07)", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Add Row</button>}
          {rowSizes.length<10 && <button onClick={()=>{
            if(isPlaying){stopMetronome();setIsPlaying(false);}
            const lastRowIdx = rowSizes.length-1;
            const offsets = getRowOffsets(rowSizes);
            const lastOffset = offsets[lastRowIdx];
            const lastSize = rowSizes[lastRowIdx];
            const lastRepeat = rowRepeats[lastRowIdx]||1;
            // New row offset will be after all existing rows
            const newOffset = offsets[lastRowIdx]+lastSize;
            // Copy strum active
            setStrumActive(p=>{
              const next=[...p];
              for(let i=0;i<lastSize;i++) next[newOffset+i]=p[lastOffset+i];
              return next;
            });
            // Copy block chords
            setBlockChords(p=>{
              const next=[...p];
              for(let i=0;i<lastSize;i++) next[newOffset+i]=p[lastOffset+i];
              return next;
            });
            setRowSizes(p=>[...p, lastSize]);
            setRowRepeats(p=>[...p, lastRepeat]);
          }} style={{
            padding:"8px 16px", borderRadius:10, border:"1px dashed #888",
            background:"rgba(255,255,255,0.04)", color:"#888", fontSize:12, fontWeight:700, cursor:"pointer" }}>⧉ Copy Row</button>}
          {rowSizes.length>1 && <button onClick={()=>{ setRowSizes(p=>p.slice(0,-1)); setRowRepeats(p=>p.slice(0,-1)); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
            padding:"8px 16px", borderRadius:10, border:"1px solid #2a2a2a",
            background:"transparent", color:"#666", fontSize:12, cursor:"pointer" }}>− Remove Row</button>}
          <button onClick={()=>{ 
            const arr = defaultBuild(8);
            while(arr.length < 80) arr.push(false);
            setStrumActive(arr);
            setBlockChords(Array(80).fill(null));
            setRowSizes([8]); setRowRepeats([1]); setLoadedPatternName(null); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
            padding:"8px 14px", borderRadius:10, border:"1px solid #2a2a2a",
            background:"transparent", color:"#444", fontSize:12, cursor:"pointer" }}>Reset All</button>
          <button onClick={()=>setSavePrompt(p=>!p)} style={{
            padding:"8px 14px", borderRadius:10, border:"1px solid #FFBE0B44",
            background:"rgba(255,190,11,0.07)", color:"#FFBE0B",
            fontSize:12, fontWeight:700, cursor:"pointer" }}>💾 Save</button>
        </div>

        {/* Save prompt */}
        {savePrompt && (
          <div style={{ marginTop:14, background:"#111", border:"1px solid #FFBE0B33",
            borderRadius:14, padding:"16px" }}>
            <div style={{ fontSize:12, color:"#888", marginBottom:8, textAlign:"center" }}>Name your pattern</div>
            <div style={{ display:"flex", gap:8 }}>
              <input autoFocus value={saveName} onChange={e=>setSaveName(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleSave()}
                placeholder="e.g. Verse riff, Intro loop..."
                style={{ flex:1, padding:"9px 12px", borderRadius:10,
                  border:"1px solid #333", background:"#0a0a0a",
                  color:"#fff", fontSize:13, outline:"none" }} />
              <button onClick={handleSave} style={{
                padding:"9px 16px", borderRadius:10, border:"none",
                background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                color:"#111", fontSize:13, fontWeight:800, cursor:"pointer" }}>Save</button>
              <button onClick={()=>{setSavePrompt(false);setSaveName("");}} style={{
                padding:"9px 12px", borderRadius:10, border:"1px solid #333",
                background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>✕</button>
            </div>
            <div style={{ fontSize:10, color:"#444", textAlign:"center", marginTop:8 }}>
              {savedPatterns.length}/20 slots used
            </div>
          </div>
        )}
      </div>

      {/* Saved Patterns */}
      <div style={{ width:"100%", marginBottom:20 }}>
        <button onClick={()=>setShowSaved(s=>!s)} style={{
          width:"100%", padding:"12px 16px", borderRadius:14,
          border:"1px solid #2a2a2a", background:"#111",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          cursor:"pointer" }}>
          <span style={{ fontSize:13, fontWeight:700, color:"#888" }}>
            📂 My Patterns <span style={{ color:"#555", fontWeight:400 }}>({savedPatterns.length}/20)</span>
          </span>
          <span style={{ color:"#555", fontSize:12 }}>{showSaved ? "▲" : "▼"}</span>
        </button>

        {showSaved && (
          <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:8 }}>
            {savedPatterns.length===0 && (
              <div style={{ textAlign:"center", color:"#444", fontSize:13, padding:"20px 0" }}>
                No saved patterns yet — build something and hit 💾
              </div>
            )}
            {savedPatterns.map((p,idx)=>(
              <div key={p.id} style={{
                background:"#111", border:"1px solid #2a2a2a", borderRadius:14,
                padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between",
              }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:800, color:"#fff",
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</div>
                  <div style={{ fontSize:11, color:"#555", marginTop:2 }}>
                    {p.rowSizes?.length} row{p.rowSizes?.length!==1?"s":""} · {p.bpm} BPM
                    {p.capo>0 && <span style={{ color:"#FFBE0B88" }}> · Capo {p.capo}</span>}
                    <span style={{ marginLeft:6 }}>· {p.savedAt}</span>
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, marginLeft:12 }}>
                  <button onClick={()=>handleLoad(p)} style={{
                    padding:"7px 14px", borderRadius:9, border:"none",
                    background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                    color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                  <button onClick={()=>handleShare(p)} style={{
                    padding:"7px 12px", borderRadius:9, border:"1px solid #333",
                    background:"transparent", color:"#6b9fff", fontSize:12,
                    fontWeight:700, cursor:"pointer" }}>🔗 Share</button>
                  <button onClick={()=>handleDelete(p.id)} style={{
                    padding:"7px 10px", borderRadius:9, border:"1px solid #333",
                    background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    {/* Copyright */}
    <div style={{ textAlign:"center", paddingTop:24, paddingBottom:8, color:"#333", fontSize:11 }}>
      © {new Date().getFullYear()} No Theory Club · All rights reserved.
    </div>
    </>
  );
}

// ─── SHARED UI COMPONENTS ────────────────────────────────────────────────────

function SectionHeader({ title, sub }) {
  return (
    <div style={{
      borderRadius:16, padding:"14px 24px",
      textAlign:"center", marginBottom:20, width:"100%",
      background:"#111", border:"1px solid #2a2a2a",
      boxShadow:"0 4px 16px rgba(0,0,0,0.5)",
    }}>
      <h1 style={{ margin:0, fontSize:21, fontWeight:900, color:"#fff", letterSpacing:0.3 }}>{title}</h1>
      <p style={{ margin:"6px 0 0", fontSize:12, color:"#aaa", lineHeight:1.6 }}>{sub}</p>
    </div>
  );
}

const MODE_GRADIENTS = [
  "linear-gradient(135deg, #FFD60A, #FFBE0B)",
  "linear-gradient(135deg, #FFBE0B, #F79200)",
];

function ModeTabs({ options, value, onChange }) {
  return (
    <div style={{ display:"flex", gap:4, marginBottom:20, background:"#0a0a0a", borderRadius:14,
      padding:4, border:"1px solid #2a2a2a", width:"100%" }}>
      {options.map(([m,label],i)=>(
        <button key={m} onClick={()=>onChange(m)} style={{
          flex:1, padding:"11px 12px", borderRadius:10, border:"none",
          background: value===m ? MODE_GRADIENTS[i] : "transparent",
          color: value===m ? "#111" : "#555",
          fontSize:14, fontWeight:900,
          textShadow: value===m ? "0 1px 3px rgba(0,0,0,0.25)" : "none",
          boxShadow: value===m ? "0 2px 10px rgba(255,190,11,0.3)" : "none",
          cursor:"pointer", transition:"all 0.2s",
          letterSpacing:0.3,
        }}>{label}</button>
      ))}
    </div>
  );
}

function ChordPickerPanel({ customChords, setCustomChords, maxChords, accentColor,
  isPlaying, stopMetronome, setIsPlaying, setChordIndex, setBeatCount, beatRef, chordRef,
  chordVariants, updateVariant, allowDuplicates=false }) {
  const [variantPickerChord, setVariantPickerChord] = useState(null);
  const [outsideKeyChord, setOutsideKeyChord] = useState(null);

  // For duplicate mode — unique set for key detection
  const uniqueChords = allowDuplicates ? [...new Set(customChords)] : customChords;
  const possibleKeys = getPossibleKeys(uniqueChords);
  const allowedChords = getAllowedChords(uniqueChords);
  const noKeyFits = customChords.length > 0 && possibleKeys.length === 0;
  return (
    <div style={{ width:"100%", background:"#0a0a0a",
      border:"1px solid #2a2a2a", borderRadius:20, padding:"16px 14px", marginBottom:20,
      boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
        <div style={{ width:32 }} />
        <div style={{ fontSize:11, color:"#888", letterSpacing:2 }}>
          {allowDuplicates ? "BUILD YOUR CHORD SET" : maxChords===6 ? "PICK YOUR CHORDS" : "BUILD YOUR CHORD SET"}
        </div>
        {customChords.length > 0
          ? <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);} setCustomChords([]); setChordIndex(0); setBeatCount(0); if(beatRef)beatRef.current=0; if(chordRef)chordRef.current=0; setLoadedDrillName(null); }} style={{ background:"none", border:"none", color:"#e74c3c", fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:0.5 }}>Reset</button>
          : <div style={{ width:32 }} />
        }
      </div>
      <div style={{ fontSize:12, color:"#555", textAlign:"center", marginBottom:14 }}>
        {customChords.length}/{maxChords} {allowDuplicates ? "slots used" : "selected"}
        {customChords.length>=1 && <span style={{ color:"#FFD166", marginLeft:8 }}>→ {customChords.join(" → ")}</span>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
        {ALL_CHORDS.map(chord=>{
          const isSel=customChords.includes(chord);
          const positions = allowDuplicates ? customChords.reduce((a,c,i)=>c===chord?[...a,i+1]:a,[]) : [];
          const isDis = allowDuplicates ? customChords.length>=maxChords : !isSel&&customChords.length>=maxChords;
          return (
            <button key={chord} disabled={isDis}
              onClick={()=>{
                if(allowDuplicates){
                  // Ordered sequence mode — always ADD on tap (use reset or chips to remove)
                  const isOutside = allowedChords && !allowedChords.has(chord);
                  if(isOutside){ setOutsideKeyChord(chord); return; }
                  if(isPlaying){stopMetronome();setIsPlaying(false);}
                  setCustomChords(p=>[...p,chord]);
                  setChordIndex(0); setBeatCount(0);
                  if(beatRef) beatRef.current=0;
                  if(chordRef) chordRef.current=0;
                  return;
                }
                if(isSel){
                  if(isPlaying){stopMetronome();setIsPlaying(false);}
                  setCustomChords(p=>p.filter(c=>c!==chord));
                  setChordIndex(0); setBeatCount(0);
                  if(beatRef) beatRef.current=0;
                  if(chordRef) chordRef.current=0;
                  return;
                }
                const isOutside = allowedChords && !allowedChords.has(chord);
                if(isOutside){ setOutsideKeyChord(chord); return; }
                if(isPlaying){stopMetronome();setIsPlaying(false);}
                setCustomChords(p=>[...p,chord]);
                setChordIndex(0); setBeatCount(0);
                if(beatRef) beatRef.current=0;
                if(chordRef) chordRef.current=0;
              }} style={{
              borderRadius:10, padding:"0 0 5px", background:"#000",
              border: isSel ? `2px solid ${accentColor}` : "2px solid #2a2210",
              cursor:isDis?"not-allowed":"pointer",
              opacity: isDis ? 0.25 : (allowedChords && !allowedChords.has(chord) && positions.length===0) ? 0.35 : 1,
              display:"flex", flexDirection:"column", alignItems:"center",
              transition:"all 0.15s", overflow:"hidden",
              filter: (allowedChords && !allowedChords.has(chord) && positions.length===0) ? "grayscale(60%)" : "none",
              boxShadow:isSel?`0 0 10px rgba(${hexToRgb(accentColor)},0.3)`:"none",
            }}>
              {getChordImg(chord, chordVariants)
                ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center", position:"relative" }}>
                    <img src={getChordImg(chord, chordVariants)} alt={chord}
                      style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                    {HAS_VARIATIONS.has(chord) && (
                      <div onClick={e=>{e.stopPropagation();setVariantPickerChord(chord);}}
                        style={{ position:"absolute", top:3, right:3, width:18, height:18,
                          borderRadius:"50%", background:"rgba(0,0,0,0.75)",
                          border:"1px solid rgba(255,190,11,0.5)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:9, color: chordVariants?.[chord]==="anchor"?"#FFBE0B":"#888",
                          cursor:"pointer", zIndex:2 }}>⚙</div>
                    )}
                  </div>
                : <div style={{ width:"100%", aspectRatio:"3/4", display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:16, fontWeight:900,
                    color:isSel?accentColor:"#333" }}>{chord}</div>
              }
              <div style={{ fontSize:10, fontWeight:800, color:isSel?accentColor:"#555", marginTop:3 }}>
                {chord}
                {allowDuplicates && positions.length > 0 && (
                  <span style={{ marginLeft:3, color:accentColor, fontSize:9 }}>
                    {positions.map(p=>`${p}`).join(" ")}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {/* Sequence chips — tap × to remove individual slot */}
      {allowDuplicates && customChords.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:10, marginTop:2 }}>
          {customChords.map((c,i)=>(
            <div key={i} style={{
              display:"flex", alignItems:"center", gap:4, padding:"4px 8px 4px 10px",
              borderRadius:20, background:"rgba(255,190,11,0.1)",
              border:"1px solid rgba(255,190,11,0.3)", fontSize:12, fontWeight:800,
              color:"#FFBE0B",
            }}>
              <span style={{ fontSize:9, color:"#888", marginRight:1 }}>{i+1}</span>
              {c}
              <button onClick={()=>{
                if(isPlaying){stopMetronome();setIsPlaying(false);}
                const next=[...customChords]; next.splice(i,1);
                setCustomChords(next); setChordIndex(0); setBeatCount(0);
                if(beatRef)beatRef.current=0; if(chordRef)chordRef.current=0;
              }} style={{ background:"none", border:"none", color:"#666",
                fontSize:12, cursor:"pointer", padding:"0 0 0 2px", lineHeight:1 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Key indicator */}
      {customChords.length > 0 && (
        <div style={{ marginTop:10, textAlign:"center" }}>
          {noKeyFits ? (
            <div style={{ fontSize:11, color:"#888", letterSpacing:0.5 }}>
              🎨 Mixed key — no single key contains all chords
            </div>
          ) : (
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, justifyContent:"center" }}>
              <span style={{ fontSize:10, color:"#555", alignSelf:"center", letterSpacing:1 }}>KEY:</span>
              {possibleKeys.map(k => (
                <span key={k.label} style={{
                  fontSize:11, fontWeight:700, color:"#FFD60A",
                  background:"rgba(255,214,10,0.08)", border:"1px solid rgba(255,214,10,0.2)",
                  borderRadius:6, padding:"2px 8px",
                }}>{k.label}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {customChords.length < 1 && (
        <div style={{ textAlign:"center", fontSize:11, color:"#555", marginTop:12 }}>
          Select at least 1 chord to start
        </div>
      )}
      {outsideKeyChord && (
        <OutsideKeyModal
          chord={outsideKeyChord}
          possibleKeys={possibleKeys}
          onAdd={()=>{
            if(isPlaying){stopMetronome();setIsPlaying(false);}
            setCustomChords(p=>[...p,outsideKeyChord]);
            setChordIndex(0); setBeatCount(0);
            if(beatRef) beatRef.current=0;
            if(chordRef) chordRef.current=0;
            setOutsideKeyChord(null);
          }}
          onCancel={()=>setOutsideKeyChord(null)}
        />
      )}
      {variantPickerChord && (
        <VariantPickerModal
          chord={variantPickerChord}
          currentVariant={chordVariants?.[variantPickerChord]||"standard"}
          onSelect={v=>{ updateVariant(variantPickerChord,v); setVariantPickerChord(null); }}
          onClose={()=>setVariantPickerChord(null)}
        />
      )}
    </div>
  );
}

function ChordGrid({ chords, chordIndex, nextChordIndex, isPlaying, accentColor, isLastBeat, bpm, beatsPerChord, chordVariants, updateVariant }) {
  const [variantPickerChord, setVariantPickerChord] = useState(null);
  const prevIdx = (chordIndex - 1 + chords.length) % chords.length;

  const cards = [
    { chord: chords[prevIdx],        type: "side" },
    { chord: chords[chordIndex],     type: "active" },
    { chord: chords[nextChordIndex], type: "side" },
  ];

  return (
    <div style={{ width:"100%", marginBottom:10 }}>

      {/* Position dots */}
      <div style={{ display:"flex", justifyContent:"center", gap:5, marginBottom:8 }}>
        {chords.map((_, i) => (
          <div key={i} style={{
            width: i===chordIndex ? 18 : 6, height:6, borderRadius:3,
            background: i===chordIndex ? accentColor : "#2a1f00",
            transition:"all 0.25s ease",
          }} />
        ))}
      </div>

      {/* Three cards — equal treatment, active just brighter */}
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        {cards.map(({ chord, type }, i) => {
          const isActive = type === "active";
          const isNext = i === 2; // right card is always next
          const highlight = isNext && isLastBeat;
          return (
            <div key={chord + i} style={{
              flex: isActive ? "0 0 46%" : "0 0 27%",
              display:"flex", flexDirection:"column", alignItems:"center",
              opacity: isActive ? 1 : highlight ? 1 : 0.35,
              transition:"opacity 0.2s ease",
            }}>
              <div style={{
                width:"100%", borderRadius:10, overflow:"hidden", background:"#000",
                border: isActive
                  ? `2px solid ${accentColor}`
                  : highlight
                    ? `2px solid ${accentColor}66`
                    : "1px solid #222",
                boxShadow: isActive
                  ? `0 0 16px rgba(${hexToRgb(accentColor)},0.4)`
                  : highlight
                    ? `0 0 10px rgba(${hexToRgb(accentColor)},0.2)`
                    : "none",
                transition:"border 0.2s ease, box-shadow 0.2s ease",
              }}>
                {getChordImg(chord, chordVariants)
                  ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center", position:"relative" }}>
                    <img src={getChordImg(chord, chordVariants)} alt={chord}
                      style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                    {isActive && HAS_VARIATIONS.has(chord) && (
                      <div onClick={e=>{e.stopPropagation();setVariantPickerChord(chord);}}
                        style={{ position:"absolute", top:4, right:4, padding:"2px 7px",
                          borderRadius:8, background:"rgba(0,0,0,0.8)",
                          border:"1px solid rgba(255,190,11,0.5)",
                          fontSize:10, fontWeight:700,
                          color: (chordVariants?.[chord]&&chordVariants[chord]!==chord)?"#FFBE0B":"#888",
                          cursor:"pointer", zIndex:2, whiteSpace:"nowrap" }}>
                        {(chordVariants?.[chord]&&chordVariants[chord]!==chord) ? (CHORD_VARIATION_MAP[chord]?.find(v=>v.key===chordVariants[chord])?.label||chordVariants[chord]) : "standard"} ⚙
                      </div>
                    )}
                  </div>
                  : <div style={{ aspectRatio:"3/4", display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:isActive?32:20, fontWeight:900,
                      color:isActive?accentColor:"#555" }}>{chord}</div>
                }
              </div>
              <div style={{ marginTop:4, fontSize:isActive?15:11, fontWeight:900,
                color: isActive ? accentColor : highlight ? accentColor+"88" : "#555",
                transition:"all 0.2s" }}>{chord}</div>
            </div>
          );
        })}
      </div>
      {variantPickerChord && (
        <VariantPickerModal
          chord={variantPickerChord}
          currentVariant={chordVariants?.[variantPickerChord]||"standard"}
          onSelect={v=>{ updateVariant(variantPickerChord,v); setVariantPickerChord(null); }}
          onClose={()=>setVariantPickerChord(null)}
        />
      )}
    </div>
  );
}

function ChordCard({ chord, isActive, accentColor }) {
  return (
    <div style={{ width:"100%", borderRadius:10, overflow:"hidden", background:"#000",
      border: isActive ? `2px solid ${accentColor}` : "1px solid #111",
      boxShadow: isActive ? `0 0 20px rgba(${hexToRgb(accentColor)},0.4)` : "none" }}>
      {ALL_CHORD_IMAGES[chord]
        ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
            <img src={ALL_CHORD_IMAGES[chord]} alt={chord}
              style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
          </div>
        : <div style={{ aspectRatio:"3/4", display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:24, fontWeight:900,
            color:isActive?accentColor:"#333" }}>{chord}</div>
      }
    </div>
  );
}

function BuildStrumPanel({ buildActive, setBuildActive, hasSecondRow, setHasSecondRow,
  row1Size, setRow1Size, row2Size, setRow2Size,
  currentBeat, isPlaying, stopMetronome, setIsPlaying,
  savedStrums, setSavedStrums, showSavedStrums, setShowSavedStrums,
  strumSavePrompt, setStrumSavePrompt, strumSaveName, setStrumSaveName }) {

  const cycleSize = (cur) => cur===8?4:cur===4?6:8;
  const sizeLabel = (n) => n===6?"Triplet":n===4?"4":"8";

  const doSave = () => {
    if(!strumSaveName.trim()) return;
    const pattern = { id:Date.now(), name:strumSaveName.trim(),
      buildActive, hasSecondRow, row1Size, row2Size,
      savedAt:new Date().toLocaleDateString() };
    const updated = [...savedStrums, pattern];
    setSavedStrums(updated);
    localStorage.setItem("ntc_strum_tab", JSON.stringify(updated));
    setStrumSavePrompt(false); setStrumSaveName(""); setShowSavedStrums(true);
  };

  const doLoad = (p) => {
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    setBuildActive(p.buildActive);
    setHasSecondRow(p.hasSecondRow||false);
    setRow1Size(p.row1Size||8);
    setRow2Size(p.row2Size||8);
    setShowSavedStrums(false);
  };

  return (
    <div style={{ width:"100%", background:"#0a0a0a",
      border:"1px solid #2a2a2a", borderRadius:20, padding:"18px 16px", marginBottom:20 }}>
      <div style={{ fontSize:11, color:"#888", letterSpacing:2, textAlign:"center", marginBottom:4 }}>BUILD YOUR PATTERN</div>
      <p style={{ textAlign:"center", fontSize:12, color:"#888", marginBottom:16 }}>Tap blocks to toggle active ↔ ghost</p>

      {/* Row 1 */}
      <div style={{ marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:5 }}>
          <div style={{ fontSize:10, color:"#444", letterSpacing:1 }}>ROW 1</div>
          <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
            const ns=cycleSize(row1Size); setRow1Size(ns);
            setBuildActive(p=>{ const n=[...p]; for(let i=ns;i<8;i++) n[i]=false; return n; });
          }} style={{ padding:"4px 12px", borderRadius:8, border:"1px solid #333",
            background:"#1a1a1a", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            {sizeLabel(row1Size)} ↻
          </button>
        </div>
        <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap" }}>
          {Array(row1Size).fill(null).map((_,i)=>(
            <BuildBlock key={i} dir={DIRS16[i%8]} active={buildActive[i]} beat={currentBeat===i&&isPlaying}
              onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                setBuildActive(p=>p.map((v,idx)=>idx===i?!v:v)); }} />
          ))}
        </div>
      </div>

      {/* Row 2 */}
      {hasSecondRow && (
        <div style={{ marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:5 }}>
            <div style={{ fontSize:10, color:"#444", letterSpacing:1 }}>ROW 2</div>
            <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
              const ns=cycleSize(row2Size); setRow2Size(ns);
              setBuildActive(p=>{ const n=[...p]; for(let i=8+ns;i<16;i++) n[i]=false; return n; });
            }} style={{ padding:"4px 12px", borderRadius:8, border:"1px solid #333",
              background:"#1a1a1a", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              {sizeLabel(row2Size)} ↻
            </button>
          </div>
          <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap" }}>
            {Array(row2Size).fill(null).map((_,i)=>(
              <BuildBlock key={i+8} dir={DIRS16[i%8]} active={buildActive[i+8]} beat={currentBeat===i+8&&isPlaying}
                onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                  setBuildActive(p=>p.map((v,idx)=>idx===i+8?!v:v)); }} />
            ))}
          </div>
        </div>
      )}

      {/* Row controls */}
      <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:12, marginBottom:16, flexWrap:"wrap" }}>
        {!hasSecondRow
          ? <button onClick={()=>{ setHasSecondRow(true);
              setBuildActive(p=>[...p.slice(0,8),...defaultBuild(8)]);
              setRow2Size(8);
              if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
              padding:"8px 18px", borderRadius:10, border:"1px solid #FFBE0B",
              background:"rgba(255,190,11,0.07)", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Add Row</button>
          : <button onClick={()=>{ setHasSecondRow(false);
              setBuildActive(p=>[...p.slice(0,8),...Array(8).fill(false)]);
              if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
              padding:"8px 18px", borderRadius:10, border:"1px solid #2a2a2a",
              background:"transparent", color:"#666", fontSize:12, cursor:"pointer" }}>− Remove Row</button>
        }
        <button onClick={()=>{ setBuildActive([...defaultBuild(8),...Array(8).fill(false)]); setRow1Size(8); }} style={{
          padding:"8px 14px", borderRadius:10, border:"1px solid #2a2a2a",
          background:"transparent", color:"#444", fontSize:12, cursor:"pointer" }}>Reset</button>
        <button onClick={()=>setStrumSavePrompt(p=>!p)} style={{
          padding:"8px 14px", borderRadius:10, border:"1px solid #FFBE0B44",
          background:"rgba(255,190,11,0.07)", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>💾 Save</button>
        <button onClick={()=>setShowSavedStrums(s=>!s)} style={{
          padding:"8px 14px", borderRadius:10, border:"1px solid #2a2a2a",
          background:"#111", color:"#888", fontSize:12, fontWeight:700, cursor:"pointer" }}>
          📂 My Patterns ({savedStrums.length})
        </button>
      </div>

      {/* Save prompt */}
      {strumSavePrompt && (
        <div style={{ marginBottom:14, background:"#111", border:"1px solid #FFBE0B33",
          borderRadius:14, padding:"14px" }}>
          <div style={{ fontSize:12, color:"#888", marginBottom:8, textAlign:"center" }}>Name this pattern</div>
          <div style={{ display:"flex", gap:8 }}>
            <input autoFocus value={strumSaveName} onChange={e=>setStrumSaveName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&doSave()}
              placeholder="e.g. D DU UDU..."
              style={{ flex:1, padding:"9px 12px", borderRadius:10,
                border:"1px solid #333", background:"#0a0a0a",
                color:"#fff", fontSize:13, outline:"none" }} />
            <button onClick={doSave} style={{ padding:"9px 16px", borderRadius:10, border:"none",
              background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
              color:"#111", fontSize:13, fontWeight:800, cursor:"pointer" }}>Save</button>
            <button onClick={()=>{setStrumSavePrompt(false);setStrumSaveName("");}} style={{
              padding:"9px 12px", borderRadius:10, border:"1px solid #333",
              background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>✕</button>
          </div>
        </div>
      )}

      {/* Saved patterns */}
      {showSavedStrums && (
        <div style={{ marginBottom:14, display:"flex", flexDirection:"column", gap:6 }}>
          {savedStrums.length===0 && (
            <div style={{ textAlign:"center", color:"#444", fontSize:13, padding:"14px 0" }}>
              No saved patterns yet — build something and hit 💾
            </div>
          )}
          {savedStrums.map(p=>(
            <div key={p.id} style={{ background:"#111", border:"1px solid #2a2a2a",
              borderRadius:12, padding:"10px 14px",
              display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#fff",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</div>
                <div style={{ fontSize:11, color:"#555", marginTop:2 }}>
                  {p.hasSecondRow?"2 rows":"1 row"} · {p.savedAt}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, marginLeft:10 }}>
                <button onClick={()=>doLoad(p)} style={{ padding:"6px 12px", borderRadius:8, border:"none",
                  background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                  color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                <button onClick={()=>{
                  const updated=savedStrums.filter(x=>x.id!==p.id);
                  setSavedStrums(updated);
                  localStorage.setItem("ntc_strum_tab", JSON.stringify(updated));
                }} style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #333",
                  background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function MetronomePanel({ bpm, setBpm, isPlaying, totalBlocks, currentBeat, accentColor,
  onToggle, canPlay, disabledLabel, countIn }) {
  return (
    <div style={{ background:"#0a0a0a", border:"1px solid #2a2a2a",
      borderRadius:20, padding:"20px 24px", width:"100%", boxShadow:"0 8px 32px rgba(0,0,0,0.6)" }}>
      <div style={{ textAlign:"center", marginBottom:14 }}>
        <span style={{ fontSize:16, fontWeight:700, textShadow:"0 1px 8px rgba(0,0,0,0.5)" }}>Metronome </span>
        <span style={{ fontSize:16, fontWeight:700, color:"#FFBE0B" }}>({bpm} BPM)</span>
      </div>
      <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:14 }}>
        {Array(Math.max(4, totalBlocks/2)).fill(null).slice(0,4).map((_,i)=>{
          const b=i*2, lit=(currentBeat===b||currentBeat===b+1)&&isPlaying;
          return <div key={i} style={{ width:11, height:11, borderRadius:"50%",
            background:lit?(i===0?"#FFBE0B":accentColor):"#2a1f00",
            boxShadow:lit?`0 0 8px ${i===0?"#FFBE0B":accentColor}`:"none",
            transition:"background 0.05s" }} />;
        })}
      </div>
      <input type="range" min={40} max={160} value={bpm}
        onChange={e=>setBpm(Number(e.target.value))}
        style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#555", marginBottom:14 }}>
        <span>40</span><span>160</span>
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:16 }}>
        {[60,80,100,120].map(b=>(
          <button key={b} onClick={()=>setBpm(b)} style={{
            padding:"5px 12px", borderRadius:8,
            border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
            background:bpm===b?"rgba(255,190,11,0.15)":"#111009",
            color:bpm===b?"#FFBE0B":"#555", fontSize:12, fontWeight:600, cursor:"pointer" }}>{b}</button>
        ))}
      </div>
      <button onClick={onToggle} disabled={!canPlay} style={{
        width:"100%", padding:"13px", borderRadius:14, border:"none",
        background: !canPlay ? "#111009"
          : countIn>0 ? "linear-gradient(135deg,#a06000,#c87800)"
          : isPlaying ? "linear-gradient(135deg,#c0392b,#e74c3c)"
          : "linear-gradient(135deg,#1a6b3c,#27ae60)",
        color:!canPlay?"#333":"#fff", fontSize: countIn>0 ? 28 : 16, fontWeight:800,
        cursor:canPlay?"pointer":"not-allowed",
        boxShadow: !canPlay?"none"
          : countIn>0 ? "0 4px 20px rgba(255,190,11,0.3)"
          : isPlaying ? "0 4px 20px rgba(231,76,60,0.4)"
          : "0 4px 20px rgba(39,174,96,0.4)",
        transition:"all 0.15s", letterSpacing: countIn>0?2:0 }}>
        {!canPlay ? (disabledLabel||"Select options to start")
          : countIn>0 ? countIn
          : isPlaying ? "⏹ Stop" : "▶ Start"}
      </button>
    </div>
  );
}

function Arrow({ dir, active, dim, beat }) {
  return (
    <div style={{ width:40, height:40, borderRadius:10, display:"flex", alignItems:"center",
      justifyContent:"center", fontSize:20,
      background: beat ? "linear-gradient(135deg,#FFBE0B,#F77F00)"
        : dim ? "#111"
        : "#1c1c1c",
      border: beat ? "2px solid #FFBE0B"
        : dim ? "1px solid #222"
        : "1px solid #555",
      opacity: dim ? 0.35 : 1,
      transform: beat ? "scale(1.12)" : "scale(1)",
      transition:"all 0.05s",
      boxShadow: beat
        ? "0 0 14px rgba(255,190,11,0.8)"
        : dim ? "none"
        : "0 0 6px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
      <span style={{ color: beat ? "#111" : dim ? "#444" : "#ccc", fontWeight:700 }}>{dir}</span>
    </div>
  );
}

function BuildBlock({ dir, active, beat, onClick, assigned }) {
  return (
    <div onClick={onClick} style={{ width:40, height:40, borderRadius:10,
      display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, cursor:"pointer",
      background: beat ? "linear-gradient(135deg,#FFBE0B,#F77F00)"
        : active ? "#1c1c1c"
        : "#111",
      border: beat ? "2px solid #FFBE0B"
        : assigned ? "2px solid rgba(255,190,11,0.5)"
        : active ? "1px solid #555"
        : "1px dashed #2a2a2a",
      opacity: active ? 1 : 0.35,
      transform: beat ? "scale(1.12)" : "scale(1)",
      transition:"all 0.08s",
      boxShadow: beat ? "0 0 14px rgba(255,190,11,0.8)"
        : assigned ? "0 0 8px rgba(255,190,11,0.2)"
        : active ? "0 0 6px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.06)"
        : "none" }}>
      <span style={{ color: beat ? "#111" : active ? "#ccc" : "#444", fontWeight:700 }}>{dir}</span>
    </div>
  );
}


// ─── OUTSIDE KEY MODAL ───────────────────────────────────────────────────────
function OutsideKeyModal({ chord, possibleKeys, onAdd, onCancel }) {
  return (
    <div onClick={onCancel} style={{
      position:"fixed", inset:0, zIndex:1000,
      background:"rgba(0,0,0,0.85)", backdropFilter:"blur(4px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:"20px",
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#111", border:"1px solid #2a2a2a", borderRadius:20,
        padding:"22px 18px", width:"100%", maxWidth:340,
        boxShadow:"0 20px 60px rgba(0,0,0,0.9)",
      }}>
        <div style={{ textAlign:"center", marginBottom:14 }}>
          <div style={{ fontSize:28, marginBottom:8 }}>🎸</div>
          <div style={{ fontSize:16, fontWeight:900, color:"#fff", marginBottom:6 }}>
            Outside the Key
          </div>
          <div style={{ fontSize:13, fontWeight:700, color:"#FFD60A", marginBottom:12 }}>
            {chord}
          </div>
          <div style={{ fontSize:13, color:"#888", lineHeight:1.6, marginBottom:10 }}>
            {possibleKeys.length > 0
              ? <>This chord doesn't naturally fit in{" "}
                  <span style={{color:"#FFD60A"}}>
                    {possibleKeys.map(k=>k.label).join(" or ")}
                  </span>.
                </>
              : <>Your chords already span multiple keys.</>
            }
          </div>
          <div style={{ fontSize:12, color:"#666", lineHeight:1.6 }}>
            That said — borrowed chords sound great and tons of hit songs use them. Add it if it feels right!
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onCancel} style={{
            flex:1, padding:"11px", borderRadius:12,
            border:"1px solid #2a2a2a", background:"transparent",
            color:"#666", fontSize:13, fontWeight:700, cursor:"pointer",
          }}>Cancel</button>
          <button onClick={onAdd} style={{
            flex:1, padding:"11px", borderRadius:12, border:"none",
            background:"linear-gradient(135deg,#FFD60A,#F77F00)",
            color:"#111", fontSize:13, fontWeight:700, cursor:"pointer",
          }}>Add Anyway</button>
        </div>
      </div>
    </div>
  );
}

// ─── VARIANT PICKER MODAL ────────────────────────────────────────────────────
function VariantPickerModal({ chord, currentVariant, onSelect, onClose }) {
  const options = CHORD_VARIATION_MAP[chord] || [{key:chord, label:chord}];
  const cols = options.length <= 2 ? options.length : options.length <= 4 ? 2 : 3;
  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, zIndex:1000,
      background:"rgba(0,0,0,0.85)", backdropFilter:"blur(4px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:"20px",
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#111", border:"1px solid #2a2a2a", borderRadius:20,
        padding:"18px 14px", width:"100%", maxWidth:380,
        boxShadow:"0 20px 60px rgba(0,0,0,0.9)",
      }}>
        <div style={{ textAlign:"center", marginBottom:14 }}>
          <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:4 }}>CHOOSE VOICING</div>
          <div style={{ fontSize:20, fontWeight:900, color:"#fff" }}>{chord}</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${cols},1fr)`, gap:8 }}>
          {options.map(opt => {
            const imgKey = normalizeKey(opt.key);
            const img = ALL_CHORD_IMAGES[imgKey] || ALL_CHORD_IMAGES[chord];
            const isSelected = (currentVariant===opt.key) || (!currentVariant && opt.key===chord);
            return (
              <div key={opt.key} onClick={()=>onSelect(opt.key)} style={{
                borderRadius:12, overflow:"hidden", cursor:"pointer",
                border: isSelected ? "2px solid #FFBE0B" : "2px solid #2a2a2a",
                background: isSelected ? "rgba(255,190,11,0.08)" : "#0a0a0a",
                boxShadow: isSelected ? "0 0 14px rgba(255,190,11,0.35)" : "none",
                transition:"all 0.15s",
              }}>
                <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center", background:"#000" }}>
                  {img
                    ? <img src={img} alt={opt.label} style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                    : <div style={{ aspectRatio:"3/4", width:"100%", display:"flex", alignItems:"center",
                        justifyContent:"center", fontSize:22, fontWeight:900, color:"#444" }}>{opt.label}</div>
                  }
                </div>
                <div style={{ padding:"6px 4px", textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:900, color: isSelected ? "#FFBE0B" : "#555" }}>{opt.label}</div>
                  {isSelected && <div style={{ fontSize:9, color:"#FFBE0B", marginTop:1, letterSpacing:1 }}>✓ SELECTED</div>}
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={onClose} style={{
          marginTop:12, width:"100%", padding:"10px", borderRadius:12, border:"1px solid #2a2a2a",
          background:"transparent", color:"#555", fontSize:13, cursor:"pointer",
        }}>Cancel</button>
      </div>
    </div>
  );
}

function PatternBtn({ label, active, onClick, accent }) {
  const color = accent?"#FFBE0B":"#FFBE0B";
  return (
    <button onClick={onClick} style={{
      padding:"8px 14px", borderRadius:10,
      border:active?`2px solid ${color}`:"2px solid #2a2210",
      background:active?`rgba(${hexToRgb(color)},0.15)`:"#111",
      color:active?color:"#555", fontSize:12, fontWeight:700, cursor:"pointer", transition:"all 0.15s" }}>
      {label}
    </button>
  );
}
