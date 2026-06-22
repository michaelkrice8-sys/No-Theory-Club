import { useState, useEffect, useRef, useCallback, Component } from "react";
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

// ─── ERROR BOUNDARY ──────────────────────────────────────────────────────────
// Catches render crashes anywhere in the app (e.g. a malformed share link) and
// shows a recoverable message instead of a blank white screen.
class ErrorBoundary extends Component {
  constructor(props){ super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(){ return { hasError: true }; }
  componentDidCatch(error, info){ console.error("App error:", error, info); }
  render(){
    if(this.state.hasError){
      return (
        <div style={{ minHeight:"100vh",
          background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
          fontFamily:"'Trebuchet MS', sans-serif", color:"#fff",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          padding:"24px", textAlign:"center" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#fff", letterSpacing:1.5, marginBottom:4 }}>NO THEORY CLUB</div>
          <div style={{ fontSize:34, marginBottom:14 }}>🎸</div>
          <div style={{ fontSize:18, fontWeight:900, color:"#fff", marginBottom:8 }}>Something went wrong</div>
          <div style={{ fontSize:13, color:"#888", lineHeight:1.6, maxWidth:320, marginBottom:20 }}>
            The app hit an unexpected error. Reloading usually fixes it. If you opened a shared link, it may be from an older version.
          </div>
          <button onClick={()=>{ window.location.href = window.location.origin + window.location.pathname; }}
            style={{ padding:"11px 22px", borderRadius:12, border:"none",
              background:"linear-gradient(135deg,#FFD60A,#F77F00)",
              color:"#111", fontSize:14, fontWeight:800, cursor:"pointer" }}>
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── DATA ───────────────────────────────────────────────────────────────────

// Centralized localStorage keys — EXACT existing strings (changing these would
// orphan users' saved data, so they must never be altered).
const STORAGE_KEYS = {
  drills:   "ntc_drills",
  patterns: "ntc_patterns",
  songs:    "ntc_songs",
  strum:    "ntc_strum",
  strumTab: "ntc_strum_tab",
};

// Slot-array sizes for the various builders (named for clarity).
const STRUM_TAB_SLOTS = 64; // StrummingTab buildActive: 8 rows × 8 slots
const ADVANCED_SLOTS  = 80; // AdvancedBuildSong strumActive/blockChords

// Shared row-size helpers (used by SongBuilder, SimpleBuildSong, BuildStrumPanel).
// NOTE: AdvancedBuildSong computes per-row VALUES with the same names locally —
// that is a different thing and is intentionally left untouched.
const cycleRowSize  = (cur) => cur===8?4:cur===4?6:8;
const rowSizeLabel  = (n)   => n===6?"Triplet":n===4?"4":"8";

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

const SUPABASE_URL = "https://midwiwtywipemlyxcvau.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pZHdpd3R5d2lwZW1seXhjdmF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzQ4NDQsImV4cCI6MjA5NDM1MDg0NH0.S68BZdL37HxQHKyZCNu1pOJIJkTqkxZJznyvhjHntK8";

async function supabaseInsert(name, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/songs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ name, data }),
  });
  if(!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  return rows[0]?.id;
}

async function supabaseFetch(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${id}&select=*`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if(!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  return rows[0] || null;
}

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
function encodeChordDrill(chords, bpm, beatsPerChord, name, variants) {
  return btoa(JSON.stringify({ c: chords, b: bpm, p: beatsPerChord, n: name||"", v: variants||{} }));
}
function decodeChordDrill(str) {
  try {
    const obj = JSON.parse(atob(str));
    return { chords: Array.isArray(obj.c)?obj.c:[], bpm: Number(obj.b)||60, beatsPerChord: Number(obj.p)||2, name: obj.n||"", chordVariants: obj.v||{} };
  } catch { return null; }
}

// ─── STRUM PATTERN URL ENCODING ─────────────────────────────────────────────
// rowSizes: array of 1-8 entries, each 4/6/8. Each row occupies 8 slots in strumActive
// (row N = indices [N*8, N*8+rowSizes[N])). strumActive total length should be 64.
function encodeStrumDrill(name, strumActive, rowSizes, songChords, bpm, beatsPerChord, chordVariants, capo) {
  const sa = strumActive.reduce((acc,v,i)=>{ if(v) acc.push(i); return acc; },[]);
  const rs = Array.isArray(rowSizes) ? rowSizes : [8];
  // Keep old fields for backward compat with older client versions
  const r2 = rs.length>=2 ? 1 : 0;
  const s1 = rs[0]||8;
  const s2 = rs[1]||8;
  return btoa(JSON.stringify({ n:name, sa, rs, r2, s1, s2, c:songChords, b:bpm, p:beatsPerChord, v:chordVariants||{}, cp:capo||0 }));
}
function decodeStrumDrill(str) {
  try {
    const obj = JSON.parse(atob(str));
    const strumActive = Array(64).fill(false);
    (obj.sa||[]).forEach(i=>{ if(i<64) strumActive[i]=true; });
    // Prefer new rs array; fall back to old r2/s1/s2 format
    let rowSizes;
    if(Array.isArray(obj.rs) && obj.rs.length>=1){
      rowSizes = obj.rs.slice(0,8).map(n=>Number(n)||8);
    } else {
      rowSizes = obj.r2 ? [Number(obj.s1)||8, Number(obj.s2)||8] : [Number(obj.s1)||8];
    }
    return {
      name: obj.n || "Shared Pattern",
      strumActive,
      rowSizes,
      // Legacy fields for callers that still use 2-row model
      hasSecondRow: rowSizes.length>=2,
      row1Size: rowSizes[0]||8,
      row2Size: rowSizes[1]||8,
      songChords: Array.isArray(obj.c) ? obj.c : [],
      bpm: Number(obj.b)||60,
      beatsPerChord: Number(obj.p)||2,
      chordVariants: obj.v || {},
      capo: Number(obj.cp)||0,
    };
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

// ─── PER-SLOT VARIANT HELPERS (Chord Switching builder) ──────────────────────
// In the chord-switching builder each slot stores its own value: either a base
// chord ("C") or a variant key ("C/B", "Am/G", "C_anchor"). These helpers let a
// slot be self-contained without relying on the global chordVariants map.

// Map a variant key back to its base chord (for key detection, grid highlight)
const VARIANT_KEY_TO_BASE = (() => {
  const m = {};
  Object.entries(CHORD_VARIATION_MAP).forEach(([base, opts]) => {
    opts.forEach(o => { m[o.key] = base; });
  });
  return m;
})();
function slotBase(slot) { return VARIANT_KEY_TO_BASE[slot] || slot; }
// Display label for a slot (e.g. "C_anchor" -> "Cadd9", "C/B" -> "C/B", "C" -> "C")
function slotLabel(slot) {
  const base = slotBase(slot);
  const opt = (CHORD_VARIATION_MAP[base] || []).find(o => o.key === slot);
  return opt ? opt.label : slot;
}
// Resolve a slot directly to image/audio key (slot is already the variant key)
function slotImg(slot) {
  const key = normalizeKey(slot);
  return ALL_CHORD_IMAGES[key] || ALL_CHORD_IMAGES[normalizeKey(slotBase(slot))] || null;
}
function slotAudioKey(slot) { return normalizeKey(slot); }

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
function App() {
  const [hasSharedPattern] = useState(() => typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("pattern"));
  const [hasSharedDrill] = useState(() => typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("drill"));
  const [hasSharedStrum] = useState(() => typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("strum"));
  const [hasSharedStrumProg] = useState(() => typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("strumprog"));
  const [hasSharedSong] = useState(() =>
    typeof window !== "undefined" && (
      new URLSearchParams(window.location.search).has("song") ||
      new URLSearchParams(window.location.search).has("id")
    )
  );

  const [buildMode, setBuildMode] = useState(
    hasSharedPattern ? "advanced"
    : hasSharedSong ? "song"
    : "simple"
  );
  const audio = useAudio();
  const [chordVariants, setChordVariants] = useState({G:"G",C:"C",Em:"Em",D:"D",Am:"Am",A:"A",E:"E",Dm:"Dm",Bm:"Bm","Fmaj7":"Fmaj7"});
  const updateVariant = (chord, variant) => setChordVariants(p=>({...p,[chord]:variant}));

  // Landing screen: shown on a clean load (no shared exercise URL). Shared links
  // hit the early returns below and never reach this, so they skip the landing.
  const [view, setView] = useState("landing"); // "landing" | "app"
  // Which destination the user picked from the landing. "song" routes to the
  // hidden Build-a-Song (beta) view; the others are the 3 main tabs.
  const [dest, setDest] = useState(null); // "strum" | "chords" | "tracker" | "song"

  // Streak shown on the landing tracker card (reads tracker's own storage).
  const [landingStreak, setLandingStreak] = useState(0);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TRACKER_STORAGE_KEY);
      if (saved) setLandingStreak(trackerStreak(JSON.parse(saved)));
    } catch (_) {}
  }, [view]);

  const goHome = () => { setView("landing"); setDest(null); };
  const pickFromLanding = (id) => { setDest(id); setView("app"); };

  // Fade the tab content in when entering the app and on each tab switch.
  // Declared up here (before any early return) so hook order stays stable.
  // Uses a keyframe animation re-triggered via forced reflow so it always runs
  // without remounting the (state-holding) tab components.
  const fadeRef = useRef(null);
  const fadeKey = view + "/" + (dest || "strum");
  useEffect(() => {
    const el = fadeRef.current;
    if (!el) return;
    el.style.animation = "none";
    // force reflow so the browser registers the removal before re-adding
    void el.offsetWidth;
    el.style.animation = "ntcFadeIn 0.4s ease both";
  }, [fadeKey]);

  const handleTabChange = (newTab) => {
    // Suspend audio context to immediately silence everything
    try {
      const ctx = audio.getContext?.();
      if(ctx && ctx.state === "running") {
        ctx.suspend().then(()=>{ setTimeout(()=>ctx.resume(), 50); });
      }
    } catch(e){}
    setDest(newTab);
  };

  const tabs = [
    { id:"strum",   label:"🎸 Strumming" },
    { id:"chords",  label:"🤚 Chords" },
    { id:"tracker", label:"🔥 Tracker" },
  ];

  // Share view — clean layout, no tabs
  const anyShared = hasSharedSong || hasSharedDrill || hasSharedStrum || hasSharedStrumProg || hasSharedPattern;

  // SongBuilder controls its OWN full-page layout (sticky header, fixed bottom bar).
  // Render it bare so we don't constrain it inside a maxWidth wrapper.
  if(hasSharedSong) return <SongBuilder audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />;

  if(anyShared) return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" }}>
      <div style={{ textAlign:"center", padding:"14px 16px 6px", background:"rgba(10,10,8,0.98)" }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#fff", letterSpacing:1.5 }}>NO THEORY CLUB</div>
        <div style={{ fontSize:10, color:"#555" }}>Guitar Practice Tool</div>
      </div>
      <div style={{ maxWidth:560, margin:"0 auto", padding:"0 16px" }}>
        {hasSharedDrill && <ChordsTab audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} sharedView={true} />}
        {hasSharedStrum && <StrummingTab audio={audio} sharedView={true} />}
        {(hasSharedStrumProg || hasSharedPattern) && (
          <BuildSongTab audio={audio} initialBuildMode={buildMode} chordVariants={chordVariants} updateVariant={updateVariant} sharedView={true} />
        )}
      </div>
    </div>
  );

  // ── Landing screen (clean visit) ──
  if(view === "landing") {
    return <LandingScreen onPick={pickFromLanding} streak={landingStreak} />;
  }

  // ── Build a Song (beta) — reached only from the landing card. Full-page,
  // its own layout, with a back-to-home control via the header logo. ──
  if(dest === "song") {
    return (
      <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
        fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" }}>
        <div style={{ textAlign:"center", padding:"16px 16px 12px" }}>
          <span onClick={goHome} style={{ display:"inline-block", cursor:"pointer", fontSize:18, fontWeight:900,
            letterSpacing:1.5, background:"linear-gradient(135deg,#FFE27A,#FFBE0B 50%,#F77F00)",
            WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent",
            filter:"drop-shadow(0 2px 10px rgba(255,140,0,0.18))" }}>NO THEORY CLUB</span>
          <div style={{ fontSize:10, color:"#6f6749", letterSpacing:2, marginTop:3, textTransform:"uppercase" }}>
            Build a Song <span style={{ color:"#F77F00", fontWeight:800 }}>· Beta</span>
          </div>
        </div>
        <div style={{ maxWidth:560, margin:"0 auto", padding:"0 16px" }}>
          <button onClick={goHome} style={{ marginBottom:12, padding:"8px 14px", borderRadius:10,
            border:"1px solid #241d10", background:"#100d09", color:"#8a7f5e",
            fontSize:12, fontWeight:700, cursor:"pointer" }}>← Home</button>
        </div>
        <BuildSongTab audio={audio} initialBuildMode={buildMode} chordVariants={chordVariants} updateVariant={updateVariant} />
      </div>
    );
  }

  // ── Main app: 3-tab shell (Strumming / Chords / Tracker) ──
  const activeTab = dest || "strum";
  return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" }}>

      {/* Brand Header — logo returns to landing */}
      <div style={{ textAlign:"center", padding:"16px 16px 12px" }}>
        <span onClick={goHome} style={{ display:"inline-block", cursor:"pointer", fontSize:18, fontWeight:900,
          letterSpacing:1.5, background:"linear-gradient(135deg,#FFE27A,#FFBE0B 50%,#F77F00)",
          WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent",
          filter:"drop-shadow(0 2px 10px rgba(255,140,0,0.18))", transition:"filter 0.2s" }}>
          NO THEORY CLUB
        </span>
        <div style={{ fontSize:10, color:"#6f6749", letterSpacing:2, marginTop:3, textTransform:"uppercase" }}>
          Guitar Practice Tool
        </div>
      </div>

      {/* Tab Bar — dark / warm-glow */}
      <div style={{ position:"sticky", top:0, zIndex:100,
        padding:"6px 16px 14px",
        background:"linear-gradient(180deg, rgba(13,11,8,0.96) 0%, rgba(13,11,8,0.85) 55%, rgba(13,11,8,0) 100%)",
        backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)" }}>
        <div style={{ display:"flex", gap:8, maxWidth:520, margin:"0 auto" }}>
          {tabs.map(t => {
            const on = activeTab === t.id;
            return (
              <button key={t.id} onClick={()=>handleTabChange(t.id)} style={{
                flex:1, position:"relative", padding:"12px 8px", borderRadius:14,
                border:`1px solid ${on ? "rgba(255,190,11,0.55)" : "#241d10"}`,
                background: on
                  ? "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.16) 0%, rgba(255,170,30,0) 65%), #16110a"
                  : "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.05) 0%, rgba(255,170,30,0) 60%), #100d09",
                color: on ? "#FFD60A" : "#8a7f5e",
                fontSize:13, fontWeight:800, letterSpacing:0.3, cursor:"pointer",
                whiteSpace:"nowrap", fontFamily:"inherit",
                boxShadow: on ? "0 0 22px rgba(255,160,20,0.18), inset 0 1px 0 rgba(255,255,255,0.04)" : "none",
                transition:"all 0.22s ease",
              }}>{t.label}</button>
            );
          })}
        </div>
      </div>

      {/* Tab Content — kept mounted via display toggle so state persists.
          The visible tab fades in via the ntcFadeIn keyframe on each switch. */}
      <style>{`@keyframes ntcFadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <div ref={fadeRef} style={{ animation:"ntcFadeIn 0.4s ease both" }}>
        <div style={{ display: activeTab==="strum" ? "block" : "none" }}>
          <StrummingTab audio={audio} />
        </div>
        <div style={{ display: activeTab==="chords" ? "block" : "none" }}>
          <ChordsTab audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />
        </div>
        <div style={{ display: activeTab==="tracker" ? "block" : "none" }}>
          <TrackerTab />
        </div>
      </div>
    </div>
  );
}

// ─── STRUMMING TAB ──────────────────────────────────────────────────────────
// ─── CHORD CAROUSEL ──────────────────────────────────────────────────────────
// Real draggable carousel: the track follows the pointer in real time, then
// snaps to the nearest card on release (a fast flick advances one). Tapping a
// peeking side card or a dot slides+locks to it. Calls onChange with the locked
// chord name. Uses regular (non-anchored) chord images.
const CAROUSEL_CARD_W = 140;
const CAROUSEL_CARD_MARGIN = 11;
const CAROUSEL_STEP = CAROUSEL_CARD_W + CAROUSEL_CARD_MARGIN * 2;

function ChordCarousel({ chords, value, onChange }) {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const cardRefs = useRef([]);
  const [activeIdx, setActiveIdx] = useState(() => Math.max(0, chords.indexOf(value)));

  const posRef = useRef(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startPosRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTRef = useRef(0);
  const velRef = useRef(0);
  const movedRef = useRef(false);
  const rafRef = useRef(null);

  const idxRef = useRef(activeIdx);
  useEffect(() => { idxRef.current = activeIdx; }, [activeIdx]);

  const vw = () => (viewportRef.current ? viewportRef.current.clientWidth : 0);
  const posFor = (i) => vw() / 2 - (i * CAROUSEL_STEP + CAROUSEL_STEP / 2);
  const nearest = () => {
    const i = Math.round((vw() / 2 - posRef.current - CAROUSEL_STEP / 2) / CAROUSEL_STEP);
    return Math.max(0, Math.min(chords.length - 1, i));
  };

  const paint = () => {
    const p = posRef.current;
    if (trackRef.current) trackRef.current.style.transform = `translateX(${p}px)`;
    const n = nearest();
    const w = vw();
    cardRefs.current.forEach((c, i) => {
      if (!c) return;
      const center = i * CAROUSEL_STEP + CAROUSEL_STEP / 2 + p;
      const dist = Math.abs(center - w / 2);
      const t = Math.min(1, dist / CAROUSEL_STEP);
      c.style.transform = `scale(${(1 - 0.18 * t).toFixed(3)})`;
      c.style.opacity = (1 - 0.55 * t).toFixed(3);
      const on = i === n;
      c.style.borderColor = on ? "rgba(255,190,11,0.6)" : "#2a2417";
      c.style.boxShadow = on ? "0 0 26px rgba(255,160,20,0.26)" : "none";
    });
  };

  const applyPos = (p) => { posRef.current = p; paint(); };

  const animateTo = (target, onDone) => {
    cancelAnimationFrame(rafRef.current);
    const start = posRef.current, dist = target - start, dur = 360, t0 = performance.now();
    const step = (now) => {
      const e = Math.min(1, (now - t0) / dur);
      const c1 = 1.70158, c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(e - 1, 3) + c1 * Math.pow(e - 1, 2);
      applyPos(start + dist * eased);
      if (e < 1) rafRef.current = requestAnimationFrame(step);
      else { applyPos(target); onDone && onDone(); }
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const lockTo = (i, animate) => {
    i = Math.max(0, Math.min(chords.length - 1, i));
    setActiveIdx(i);
    onChange && onChange(chords[i]);
    if (animate) animateTo(posFor(i)); else applyPos(posFor(i));
  };

  // Pointer handlers
  const down = (x) => {
    draggingRef.current = true; movedRef.current = false;
    cancelAnimationFrame(rafRef.current);
    startXRef.current = x; startPosRef.current = posRef.current;
    lastXRef.current = x; lastTRef.current = performance.now(); velRef.current = 0;
    if (viewportRef.current) viewportRef.current.style.cursor = "grabbing";
  };
  const move = (x) => {
    if (!draggingRef.current) return;
    const delta = x - startXRef.current;
    if (Math.abs(delta) > 6) movedRef.current = true;
    let n = startPosRef.current + delta;
    const minP = posFor(chords.length - 1), maxP = posFor(0);
    if (n > maxP) n = maxP + (n - maxP) * 0.35;
    if (n < minP) n = minP + (n - minP) * 0.35;
    applyPos(n);
    const now = performance.now(), dt = now - lastTRef.current;
    if (dt > 0) velRef.current = (x - lastXRef.current) / dt;
    lastXRef.current = x; lastTRef.current = now;
  };
  const up = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (viewportRef.current) viewportRef.current.style.cursor = "grab";
    const F = 0.5;
    let t = nearest();
    if (velRef.current < -F) t = nearest() + 1;
    else if (velRef.current > F) t = nearest() - 1;
    lockTo(t, true);
  };

  // Mouse + touch listeners (window-level for move/up so drag continues off-element)
  useEffect(() => {
    const mm = (e) => move(e.clientX);
    const mu = () => up();
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    return () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
  }); // eslint-disable-line

  // Center the initial / external value, and re-center on resize.
  useEffect(() => {
    applyPos(posFor(idxRef.current));
    const onResize = () => applyPos(posFor(idxRef.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }); // eslint-disable-line

  return (
    <div>
      <div ref={viewportRef}
        onMouseDown={(e)=>{ e.preventDefault(); down(e.clientX); }}
        onTouchStart={(e)=>down(e.touches[0].clientX)}
        onTouchMove={(e)=>move(e.touches[0].clientX)}
        onTouchEnd={up}
        onClick={(e)=>{
          if (movedRef.current) return;
          const card = e.target.closest("[data-cidx]");
          if (card) lockTo(Number(card.getAttribute("data-cidx")), true);
        }}
        style={{ position:"relative", width:"100%", height:264, overflow:"hidden",
          touchAction:"pan-y", cursor:"grab", userSelect:"none", WebkitUserSelect:"none", marginBottom:4 }}>
        {/* edge fades */}
        <div style={{ position:"absolute", top:0, bottom:0, left:0, width:64, zIndex:5, pointerEvents:"none",
          background:"linear-gradient(90deg, #0d0d0a 0%, rgba(13,13,10,0) 100%)" }} />
        <div style={{ position:"absolute", top:0, bottom:0, right:0, width:64, zIndex:5, pointerEvents:"none",
          background:"linear-gradient(270deg, #0d0d0a 0%, rgba(13,13,10,0) 100%)" }} />
        <div ref={trackRef} style={{ position:"absolute", top:0, left:0, height:"100%",
          display:"flex", alignItems:"center", willChange:"transform" }}>
          {chords.map((c, i) => {
            const img = ALL_CHORD_IMAGES[c];
            return (
              <div key={c} data-cidx={i} ref={el=>cardRefs.current[i]=el}
                style={{ flex:"0 0 auto", width:CAROUSEL_CARD_W, height:200,
                  margin:`0 ${CAROUSEL_CARD_MARGIN}px`, borderRadius:16, border:"1px solid #2a2417",
                  overflow:"hidden", background:"#000", display:"flex",
                  transition:"border-color 0.25s, box-shadow 0.25s" }}>
                {img
                  ? <img src={img} alt={c} draggable={false}
                      style={{ width:"100%", height:"100%", display:"block", objectFit:"cover", pointerEvents:"none" }} />
                  : <span style={{ margin:"auto", fontSize:58, fontWeight:900, color:"#FFBE0B" }}>{c}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* dots */}
      <div style={{ display:"flex", gap:7, justifyContent:"center", marginTop:10, marginBottom:8 }}>
        {chords.map((c, i) => (
          <div key={c} onClick={()=>lockTo(i, true)} style={{ height:6, cursor:"pointer", borderRadius:3,
            width: i===activeIdx ? 22 : 6,
            background: i===activeIdx ? "linear-gradient(90deg,#FFD60A,#F77F00)" : "#2a1f0a",
            boxShadow: i===activeIdx ? "0 0 8px rgba(255,190,11,0.5)" : "none",
            transition:"all 0.3s ease" }} />
        ))}
      </div>
    </div>
  );
}

function StrummingTab({ audio, sharedView=false }) {
  const { init, playClick, playStrum, playChordStrum } = audio;
  const [mode, setMode] = useState("practice");
  const [pattern, setPattern] = useState(null);
  const [activeBtn, setActiveBtn] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0); // 3..2..1 count-in; 0 = inactive
  const countdownRef = useRef(null);
  const [bpm, setBpm] = useState(60);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [buildActive, setBuildActive] = useState(()=>{
    const arr = [];
    for(let r=0;r<8;r++) arr.push(...(r===0 ? defaultBuild(8) : Array(8).fill(false)));
    return arr; // length 64
  });
  const [rowSizes, setRowSizes] = useState([8]); // 1-8 entries, each 4/6/8
  const [strumChord, setStrumChord] = useState("G");
  const [savedStrums, setSavedStrums] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem(STORAGE_KEYS.strumTab)||"[]"); } catch{ return []; }
  });
  const [showSavedStrums, setShowSavedStrums] = useState(false);
  const [strumSavePrompt, setStrumSavePrompt] = useState(false);
  const [strumSaveName, setStrumSaveName] = useState("");
  const [sharedViewName, setSharedViewName] = useState(null);
  const [builderOpen, setBuilderOpen] = useState(true);

  const STRUM_CHORDS = ["G", "C", "Em", "D"];

  const intervalRef = useRef(null);
  const beatRef = useRef(-1);
  const bpmRef = useRef(bpm);
  const totalBeatsRef = useRef(8);
  const modeRef = useRef(mode);
  const patternRef = useRef(pattern);
  const buildActiveRef = useRef(buildActive);
  const strumChordRef = useRef(strumChord);
  const rowSizesRef = useRef(rowSizes);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ modeRef.current=mode; },[mode]);
  useEffect(()=>{ patternRef.current=pattern; },[pattern]);
  useEffect(()=>{ buildActiveRef.current=buildActive; },[buildActive]);
  useEffect(()=>{ strumChordRef.current=strumChord; },[strumChord]);
  useEffect(()=>{ rowSizesRef.current=rowSizes; },[rowSizes]);
  useEffect(()=>{
    totalBeatsRef.current = mode==="build" ? rowSizes.reduce((a,b)=>a+b,0) : 8;
  },[mode,rowSizes]);

  // Map a sequential beat (0..total-1) to its slot index in buildActive.
  // Row N occupies indices [N*8, N*8+rowSizes[N]) in the flat 64-slot array.
  const beatToSlot = (beat, sizes) => {
    let cum = 0;
    for(let r=0;r<sizes.length;r++){
      if(beat < cum + sizes[r]) return r*8 + (beat - cum);
      cum += sizes[r];
    }
    return 0;
  };

  const tick = useCallback(()=>{
    const total=totalBeatsRef.current;
    const next=(beatRef.current+1)%total;
    beatRef.current=next;
    const cm=modeRef.current;
    const sizes = rowSizesRef.current;
    const mappedIdx = cm==="build" ? beatToSlot(next, sizes) : next;
    setCurrentBeat(cm==="build" ? mappedIdx : next);
    if(next%4===0) playClick(next===0);
    const isDown = (cm==="build" ? mappedIdx : next)%2===0;
    let shouldStrum = cm==="build" ? buildActiveRef.current[mappedIdx]===true
      : patternRef.current ? patternRef.current.active[next]===true : true;
    if(shouldStrum) playChordStrum(strumChordRef.current, isDown);
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

  const scrubbingRef = useRef(false);
  useEffect(()=>{ if(isPlaying && !scrubbingRef.current){stopMetronome();startMetronome();} },[bpm]);
  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[rowSizes]);
  useEffect(()=>()=>clearInterval(intervalRef.current),[]);

  // Load from ?strum= URL on mount
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("strum");
    if(encoded){
      const d = decodeStrumDrill(encoded);
      if(d){
        // Ensure buildActive is length 64
        const sa = [...d.strumActive];
        while(sa.length < 64) sa.push(false);
        setBuildActive(sa);
        setRowSizes(d.rowSizes && d.rowSizes.length ? d.rowSizes : [8]);
        if(d.bpm) setBpm(d.bpm);
        setMode("build");
        setSharedViewName(d.name||"Shared Pattern");
        setStrumSaveName(d.name||"Shared Pattern");
        setBuilderOpen(false);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  // eslint-disable-next-line
  },[]);

  const handleTogglePlay = async ()=>{
    // During countdown: "tap to skip" → start immediately.
    if(countdown>0){
      clearInterval(countdownRef.current); countdownRef.current=null;
      setCountdown(0);
      startMetronome(); setIsPlaying(true);
      return;
    }
    if(isPlaying){ stopMetronome(); setIsPlaying(false); return; }
    await init();
    // 3 → 2 → 1 with a beep each second, then start.
    setCountdown(3);
    playClick(false); // beep on "3"
    countdownRef.current = setInterval(()=>{
      setCountdown(c=>{
        if(c<=1){
          clearInterval(countdownRef.current); countdownRef.current=null;
          startMetronome(); setIsPlaying(true);
          return 0;
        }
        playClick(false); // beep on "2" and "1"
        return c-1;
      });
    }, 1000);
  };
  useEffect(()=>()=>clearInterval(countdownRef.current),[]);

  const totalBlocks = mode==="build" ? rowSizes.reduce((a,b)=>a+b,0) : 8;
  const displayPattern = pattern ? pattern.active : Array(8).fill(true);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding: sharedView ? "12px 0" : "24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      {!sharedView && (
        <>
          <SectionHeader title="Foundations of Strumming"
            sub="Every pattern uses the same motion — ghost strokes keep the rhythm, they just miss the strings." />

          <ModeTabs options={[["practice","🎸 Practice"],["build","🛠 Build"]]}
            value={mode} onChange={m=>{ setMode(m); stopMetronome(); setIsPlaying(false); }} />
        </>
      )}

      {/* Chord selector — draggable carousel (non-anchored voicings) */}
      <div style={{ width:"100%", marginBottom:14 }}>
        <div style={{ fontSize:10, color:"#5a5238", letterSpacing:2, textAlign:"center",
          marginBottom:12, textTransform:"uppercase", fontWeight:700 }}>
          Strum Chord
        </div>
        <ChordCarousel chords={STRUM_CHORDS} value={strumChord} onChange={setStrumChord} />
        <div style={{ textAlign:"center", fontSize:11, color:"#5a5238", marginTop:2 }}>
          Swipe or tap to <b style={{ color:"#8a7f5e" }}>change the chord</b>
        </div>
      </div>

      {mode==="practice" && (
        <>
          <div style={{ marginBottom:10, textAlign:"center" }}>
            <span style={{ fontSize:17, fontWeight:700 }}>Universal Strumming </span>
            <span style={{ fontSize:17, fontWeight:700, color:"#FFBE0B" }}>"Motion"</span>
          </div>
          <div style={{ display:"flex", gap:7, marginBottom:10 }}>
            {(pattern ? displayPattern : Array(8).fill(true)).map((a,i)=>(
              <Arrow key={i} dir={DIRS16[i]} active={a} dim={pattern ? !a : false} beat={currentBeat===i&&isPlaying} />
            ))}
          </div>
          {pattern && (
            <p style={{ fontSize:11, color:"#5a5238", marginBottom:16 }}>
              <span style={{ color:"#8a7f5e", fontWeight:700 }}>{pattern.name}</span> · ⬛ ghost stroke — arm moves, misses strings
            </p>
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
          rowSizes={rowSizes} setRowSizes={setRowSizes}
          bpm={bpm} setBpm={setBpm}
          currentBeat={currentBeat} isPlaying={isPlaying}
          stopMetronome={stopMetronome} setIsPlaying={setIsPlaying}
          savedStrums={savedStrums} setSavedStrums={setSavedStrums}
          showSavedStrums={showSavedStrums} setShowSavedStrums={setShowSavedStrums}
          strumSavePrompt={strumSavePrompt} setStrumSavePrompt={setStrumSavePrompt}
          strumSaveName={strumSaveName} setStrumSaveName={setStrumSaveName}
          builderOpen={builderOpen} setBuilderOpen={setBuilderOpen}
          sharedViewName={sharedViewName} />
      )}

      <MetronomePanel bpm={bpm} setBpm={setBpm} isPlaying={isPlaying}
        totalBlocks={totalBlocks} currentBeat={currentBeat}
        accentColor="#FFBE0B" onToggle={handleTogglePlay}
        canPlay={true} countdown={countdown}
        onScrubStart={()=>{ if(isPlaying){ scrubbingRef.current=true; stopMetronome(); } }}
        onScrubEnd={()=>{ if(scrubbingRef.current){ scrubbingRef.current=false; startMetronome(); } }} />
      {/* Copyright */}
      <div style={{ textAlign:"center", paddingTop:24, paddingBottom:8, color:"#333", fontSize:11 }}>
        © {new Date().getFullYear()} No Theory Club · All rights reserved.
      </div>
    </div>
  );
}

// ─── CHORDS TAB ─────────────────────────────────────────────────────────────
function ChordsTab({ audio, chordVariants, updateVariant, sharedView=false }) {
  const { init, playChordClick, playChordStrum } = audio;
  const [viewMode, setViewMode] = useState("presets");
  const [selectedPack, setSelectedPack] = useState(null);
  const [customChords, setCustomChords] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(60);
  const [beatsPerChord, setBeatsPerChord] = useState(2);
  const [chordIndex, setChordIndex] = useState(0);
  const [beatCount, setBeatCount] = useState(0);
  const [countdown, setCountdown] = useState(0); // 3..2..1 before play; 0 = inactive
  const countdownRef = useRef(null);

  const [randomOrder, setRandomOrder] = useState(false);
  const [randomNextDisplay, setRandomNextDisplay] = useState(0);
  const [savedDrills, setSavedDrills] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem(STORAGE_KEYS.drills)||"[]"); } catch{ return []; }
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
        // Migrate legacy drills: if chords are base names + a global variants map,
        // bake the variant choice into each slot so per-slot rendering shows it.
        const v = decoded.chordVariants || {};
        const hasLegacyVariants = Object.values(v).some(x => x && x !== "" && Object.keys(VARIANT_KEY_TO_BASE).includes(x));
        const migratedChords = hasLegacyVariants
          ? decoded.chords.map(c => {
              const variantKey = v[c];
              // Only swap if it's a real variant key (e.g. "Em7", "C_anchor", "C/B")
              // — skip identity mappings like {Em: "Em"}.
              return (variantKey && variantKey !== c && Object.keys(VARIANT_KEY_TO_BASE).includes(variantKey))
                ? variantKey : c;
            })
          : decoded.chords;
        setCustomChords(migratedChords);
        setBpm(decoded.bpm);
        setBeatsPerChord(decoded.beatsPerChord);
        const drillName = decoded.name || "Shared Drill";
        setLoadedDrillName(drillName);
        setDrillSaveName(drillName);
        setPickerOpen(false);
        if(decoded.chordVariants && Object.keys(decoded.chordVariants).length > 0)
          Object.entries(decoded.chordVariants).forEach(([c,v])=>updateVariant(c,v));
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
    if(isFirst) {
      const slot = chords[chordRef.current];
      let audioKey;
      if(vmRef.current==="build"){
        // Build mode: slot is self-contained (base chord or variant key)
        audioKey = slotAudioKey(slot);
      } else {
        const pk=packRef.current?CHORD_PACKS[packRef.current]:null;
        const eff=pk?.useAnchors?{...chordVariants,...Object.fromEntries(["G","C","Em","D"].map(c=>[c,c+"_anchor"]))}:chordVariants;
        audioKey = getAudioKey(slot, eff);
      }
      playChordStrum(audioKey, true);
    }
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

  const scrubbingRef = useRef(false);
  useEffect(()=>{ if(isPlaying && !scrubbingRef.current){stopMetronome();startMetronome();} },[bpm,beatsPerChord]);
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
    // During countdown: "tap to skip" → start playing immediately.
    if(countdown>0){
      clearInterval(countdownRef.current); countdownRef.current=null;
      setCountdown(0);
      startMetronome(); setIsPlaying(true);
      return;
    }
    if(isPlaying){
      stopMetronome(); setIsPlaying(false);
      return;
    }
    if(!canPlay) return;
    await init();
    // 3 → 2 → 1 with a beep each second, then start.
    setCountdown(3);
    playChordClick(false); // beep on "3"
    countdownRef.current = setInterval(()=>{
      setCountdown(c=>{
        if(c<=1){
          clearInterval(countdownRef.current); countdownRef.current=null;
          startMetronome(); setIsPlaying(true);
          return 0;
        }
        playChordClick(false); // same beep on "2" and "1"
        return c-1;
      });
    }, 1000);
  };
  useEffect(()=>()=>clearInterval(countdownRef.current),[]);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding: sharedView ? "12px 0" : "24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      {!sharedView && (
        <>
          <SectionHeader title="Chord Switching"
            sub={<>The goal is a clean chord <em style={{color:"#666"}}>before</em> the beat hits.</>} />

          <ModeTabs options={[["presets","🎵 Presets"],["build","🛠 Build Your Own"]]}
            value={viewMode} onChange={m=>{ setViewMode(m); stopMetronome(); setIsPlaying(false);
              setChordIndex(0); setBeatCount(0); beatRef.current=0; chordRef.current=0; }} />
        </>
      )}

      {!sharedView && viewMode==="presets" && (
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
              allowDuplicates={true} onReset={()=>setLoadedDrillName(null)} />
          )}
          {!sharedView && (
            <button onClick={()=>setPickerOpen(o=>!o)} style={{
              width:"100%", marginBottom:12, padding:"8px",
              borderRadius:10, border:"1px solid #2a2a2a",
              background:"transparent",
              color:"#555", fontSize:11, fontWeight:700,
              cursor:"pointer", letterSpacing:1,
            }}>
              {pickerOpen ? "▲  HIDE BUILDER" : "▼  SHOW BUILDER"}
            </button>
          )}
        </>
      )}

      {chords.length>=2 && (
        <ChordGrid chords={chords} chordIndex={chordIndex} nextChordIndex={nextChordIndex}
          isPlaying={isPlaying} accentColor={accentColor} isLastBeat={isLastBeat}
          bpm={bpm} beatsPerChord={beatsPerChord} countdown={countdown}
          chordVariants={effectiveVariants} updateVariant={updateVariant}
          perSlot={viewMode==="build"} setCustomChords={setCustomChords} chordIndexVal={chordIndex} />
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
        onToggle={handleTogglePlay} canPlay={canPlay} countdown={countdown}
        disabledLabel={viewMode==="build"?"Select 2+ chords":"Select a pack"}
        onScrubStart={()=>{ if(isPlaying){ scrubbingRef.current=true; stopMetronome(); } }}
        onScrubEnd={()=>{ if(scrubbingRef.current){ scrubbingRef.current=false; startMetronome(); } }} />

      {!sharedView && viewMode==="build" && (
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
                      chordVariants:{...chordVariants},
                      savedAt:new Date().toLocaleDateString() };
                    const updated=[...savedDrills, drill];
                    setSavedDrills(updated);
                    localStorage.setItem(STORAGE_KEYS.drills, JSON.stringify(updated));
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
                    chordVariants:{...chordVariants},
                    savedAt:new Date().toLocaleDateString() };
                  const updated=[...savedDrills, drill];
                  setSavedDrills(updated);
                  localStorage.setItem(STORAGE_KEYS.drills, JSON.stringify(updated));
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
                      {d.chords.map(slotLabel).join(" → ")} · {d.bpm} BPM · {d.beatsPerChord} beat{d.beatsPerChord!==1?"s":""}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:6, marginLeft:10 }}>
                    <button onClick={()=>{
                      if(isPlaying){stopMetronome();setIsPlaying(false);}
                      // Migrate legacy drills (base chords + global variants map)
                      const v = d.chordVariants || {};
                      const hasLegacyVariants = Object.values(v).some(x => x && x !== "" && Object.keys(VARIANT_KEY_TO_BASE).includes(x));
                      const migratedChords = hasLegacyVariants
                        ? d.chords.map(c => {
                            const variantKey = v[c];
                            return (variantKey && variantKey !== c && Object.keys(VARIANT_KEY_TO_BASE).includes(variantKey))
                              ? variantKey : c;
                          })
                        : d.chords;
                      setCustomChords(migratedChords); setBpm(d.bpm); setBeatsPerChord(d.beatsPerChord);
                      if(d.chordVariants) Object.entries(d.chordVariants).forEach(([c,v])=>updateVariant(c,v));
                      setChordIndex(0); setBeatCount(0); beatRef.current=0; chordRef.current=0;
                      setLoadedDrillName(d.name);
                      setShowSavedDrills(false);
                    }} style={{ padding:"6px 12px", borderRadius:8, border:"none",
                      background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                      color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                    <button onClick={()=>{
                      // Migrate legacy drills before encoding so share links carry variants
                      const v = d.chordVariants || {};
                      const hasLegacyVariants = Object.values(v).some(x => x && x !== "" && Object.keys(VARIANT_KEY_TO_BASE).includes(x));
                      const migratedChords = hasLegacyVariants
                        ? d.chords.map(c => {
                            const variantKey = v[c];
                            return (variantKey && variantKey !== c && Object.keys(VARIANT_KEY_TO_BASE).includes(variantKey))
                              ? variantKey : c;
                          })
                        : d.chords;
                      const encoded = encodeChordDrill(migratedChords, d.bpm, d.beatsPerChord, d.name, d.chordVariants||{});
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
                      localStorage.setItem(STORAGE_KEYS.drills, JSON.stringify(updated));
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
function BuildSongTab({ audio, initialBuildMode="simple", chordVariants, updateVariant, sharedView=false }) {
  const [buildMode, setBuildMode] = useState(initialBuildMode);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding: sharedView ? "12px 0" : "24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      {!sharedView && (
        <>
          <SectionHeader title="🎵 Build a Song"
            sub="Build chords and strumming patterns together." />

          <ModeTabs options={[["simple","🎸 Simple"],["advanced","⚡ Advanced"],["song","📋 Song"]]}
            value={buildMode} onChange={setBuildMode} />
        </>
      )}

      {buildMode === "simple" && <SimpleBuildSong audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} sharedView={sharedView} />}
      {buildMode === "advanced" && <AdvancedBuildSong audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} sharedView={sharedView} />}
      {buildMode === "song" && <SongBuilder audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />}
    </div>
  );
}

// ─── SONG BUILDER (sections) ─────────────────────────────────────────────────
function makeSongRow() {
  return { id: Date.now() + Math.random(), size:8, repeat:1,
    strumActive: [true,false,true,false,false,true,true,true], blockChords: Array(8).fill(null), text:"", textSize:20, textOpen:false };
}
function makeSection(name) {
  return { id: Date.now() + Math.random(), name, repeat:1, rows: [makeSongRow()] };
}

function SongBuilder({ audio, chordVariants, updateVariant }) {
  const { init, playChordClick, playChordStrum } = audio;

  // ── Editor state ──
  const [sections, setSections] = useState([makeSection("Verse 1"), makeSection("Chorus")]);
  const [assignSectionId, setAssignSectionId] = useState(null);
  const [assignChord, setAssignChord] = useState("G");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [modalDragIdx, setModalDragIdx] = useState(null);
  const [modalDragOver, setModalDragOver] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");

  // ── Playback state ──
  const [bpm, setBpm] = useState(80);
  const [capo, setCapo] = useState(0);
  const [muteClick, setMuteClick] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(0);
  const scrollSpeedRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countIn, setCountIn] = useState(0);
  const [countInBeat, setCountInBeat] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);
  const [playPos, setPlayPos] = useState({ secIdx:0, rowIdx:0, beat:-1, pass:0 });

  // ── Refs ──
  const intervalRef = useRef(null);
  const countInRef = useRef(null);
  const bpmRef = useRef(bpm);
  const capoRef = useRef(capo);
  const muteRef = useRef(muteClick);
  const sectionsRef = useRef(sections);
  const playPosRef = useRef({ secIdx:0, rowIdx:0, beat:-1, pass:0 });
  const rowDomRefs = useRef({});
  const currentChordRef = useRef(null);
  const countdownTargetRef = useRef({ secIdx:0, rowIdx:0 }); // tracks which row countdown shows on
  const scrollVelocityRef = useRef(0);   // px per RAF frame
  const scrollRafRef = useRef(null);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ capoRef.current=capo; },[capo]);
  useEffect(()=>{ muteRef.current=muteClick; },[muteClick]);
  // Sync ref and update live velocity if already playing
  useEffect(()=>{
    scrollSpeedRef.current = scrollSpeed;
    if(isPlaying || isPaused){
      scrollVelocityRef.current = scrollSpeed * 0.18;
      // If speed went to 0, RAF stops itself; if > 0 and stopped, restart
      if(scrollSpeed > 0 && !scrollRafRef.current)
        scrollRafRef.current = requestAnimationFrame(runScrollRef.current);
    }
  },[scrollSpeed]);
  useEffect(()=>{ sectionsRef.current=sections; },[sections]);
  useEffect(()=>()=>{ clearInterval(intervalRef.current); clearInterval(countInRef.current); if(scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); },[]);

  // ── Constant-velocity scroll — set once at play start, never recalculated ──
  const runScrollRef = useRef(null);
  const scrollAccRef = useRef(0); // accumulates fractional pixels
  runScrollRef.current = ()=>{
    if(scrollVelocityRef.current === 0){ scrollRafRef.current = null; scrollAccRef.current = 0; return; }
    scrollAccRef.current += scrollVelocityRef.current;
    const px = Math.trunc(scrollAccRef.current);
    if(px !== 0){
      window.scrollBy(0, px);
      scrollAccRef.current -= px;
    }
    scrollRafRef.current = requestAnimationFrame(runScrollRef.current);
  };
  const runScroll = runScrollRef.current;

  const startConstantScroll = useCallback(()=>{
    if(scrollSpeedRef.current === 0) return;
    scrollVelocityRef.current = scrollSpeedRef.current * 0.18;
    if(scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(runScrollRef.current);
  },[]);

  // Smooth scroll to active row on each row change
  const scrollToRow = useCallback((secId, rowIdx)=>{
    const el = rowDomRefs.current[`${secId}_${rowIdx}`];
    if(!el) return;
    el.scrollIntoView({ behavior:'smooth', block:'center' });
  },[]);

  // ── Tick — 16th note per block, matching AdvancedBuildSong exactly ──
  const tick = useCallback(()=>{
    const secs = sectionsRef.current;
    if(!secs.length) return;

    let { secIdx, rowIdx, beat, pass } = playPosRef.current;
    const prevRowIdx = rowIdx, prevSecIdx = secIdx;

    beat++;
    const sec = secs[secIdx];
    if(!sec) return;
    const row = sec.rows[rowIdx];
    if(!row) return;

    if(beat >= row.size){
      beat = 0; pass++;
      if(pass >= (row.repeat||1)){
        pass = 0; rowIdx++;
        if(rowIdx >= sec.rows.length){
          rowIdx = 0;
          // Section repeat logic
          const secRepeat = sec.repeat||1;
          if(!playPosRef.current._secPass) playPosRef.current._secPass = 0;
          playPosRef.current._secPass++;
          if(playPosRef.current._secPass >= secRepeat){
            playPosRef.current._secPass = 0;
            secIdx++;
          }
        }
        if(secIdx >= secs.length){ secIdx = 0; playPosRef.current._secPass = 0; }
      }
    }

    playPosRef.current = { secIdx, rowIdx, beat, pass };
    setPlayPos({ secIdx, rowIdx, beat, pass });

    // Click every 4 blocks = quarter notes
    if(!muteRef.current && beat % 4 === 0)
      playChordClick(beat === 0 && pass === 0);

    // Track chord and strum on every active block
    const playRow = sectionsRef.current[secIdx]?.rows[rowIdx];
    if(playRow){
      if(playRow.blockChords[beat]) currentChordRef.current = playRow.blockChords[beat];
      if(playRow.strumActive[beat] && currentChordRef.current){
        const isDown = beat % 2 === 0;
        playChordStrum(currentChordRef.current, isDown, capoRef.current);
      }
    }

    // Scroll when row changes — non-blocking, user can always scroll freely
    if(rowIdx !== prevRowIdx || secIdx !== prevSecIdx){
      const targetSec = sectionsRef.current[secIdx];
      if(targetSec) scrollToRow(targetSec.id, rowIdx);
    }
  },[playChordClick, playChordStrum, scrollToRow]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    playPosRef.current = { secIdx:0, rowIdx:0, beat:-1, pass:0 };
    setPlayPos({ secIdx:0, rowIdx:0, beat:-1, pass:0 });
    currentChordRef.current = null;
    const ms = (60/bpmRef.current/4)*1000; // 16th note per block
    intervalRef.current = setInterval(tick, ms);
    tick(); // fire immediately — no gap after countdown
  },[tick]);

  const stopMetronome = useCallback(()=>{
    clearInterval(intervalRef.current); intervalRef.current = null;
    scrollVelocityRef.current = 0;
    if(scrollRafRef.current){ cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = null; }
    currentChordRef.current = null;
    setPlayPos({ secIdx:0, rowIdx:0, beat:-1, pass:0 });
    playPosRef.current = { secIdx:0, rowIdx:0, beat:-1, pass:0 };
  },[]);

  const pauseMetronome = useCallback(()=>{
    // Pause without resetting position
    clearInterval(intervalRef.current); intervalRef.current = null;
    scrollVelocityRef.current = 0;
    if(scrollRafRef.current){ cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = null; }
  },[]);

  const resumeMetronome = useCallback(()=>{
    // Resume from current position
    if(intervalRef.current) clearInterval(intervalRef.current);
    const ms = (60/bpmRef.current/4)*1000;
    intervalRef.current = setInterval(tick, ms);
    tick();
  },[tick]);

  const startFromSection = useCallback(async(secIdx)=>{
    if(!intervalRef.current) await init();
    clearInterval(intervalRef.current); intervalRef.current = null;
    if(scrollRafRef.current){ cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = null; }
    currentChordRef.current = null;
    playPosRef.current = { secIdx, rowIdx:0, beat:-1, pass:0, _secPass:0 };
    setPlayPos({ secIdx, rowIdx:0, beat:-1, pass:0 });
    setIsPaused(false);
    setCountIn(0); setCountInBeat(-1);
    const ms = (60/bpmRef.current/4)*1000;
    intervalRef.current = setInterval(tick, ms);
    tick();
    setIsPlaying(true);
  },[init, tick]);

  const startFromRow = useCallback(async(secIdx, rowIdx)=>{
    countdownTargetRef.current = { secIdx, rowIdx }; // set immediately, no async delay
    await init();
    clearInterval(intervalRef.current); intervalRef.current = null;
    clearInterval(countInRef.current);
    if(scrollRafRef.current){ cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = null; }
    currentChordRef.current = null;
    playPosRef.current = { secIdx, rowIdx, beat:-1, pass:0, _secPass:0 };
    setPlayPos({ secIdx, rowIdx, beat:-1, pass:0 });
    setIsPlaying(false); setIsPaused(false);
    // 4-beat countdown then start
    const ms = (60/bpmRef.current)*1000;
    let beat = 4, beatIdx = 0;
    setCountIn(beat); setCountInBeat(beatIdx); playChordClick(true);
    countInRef.current = setInterval(()=>{
      beat--; beatIdx += 2;
      if(beat <= 0){
        clearInterval(countInRef.current);
        setCountIn(0); setCountInBeat(-1);
        const ms16 = (60/bpmRef.current/4)*1000;
        intervalRef.current = setInterval(tick, ms16);
        tick();
        setIsPlaying(true);
      } else {
        setCountIn(beat); setCountInBeat(beatIdx%8); playChordClick(false);
      }
    }, ms);
  },[init, tick, playChordClick]);

  useEffect(()=>{
    bpmRef.current = bpm;
    if(isPlaying){
      pauseMetronome();
      setIsPlaying(false);
      setIsPaused(true);
    }
  },[bpm]);
  useEffect(()=>()=>clearInterval(intervalRef.current),[]);

  // ── Countdown — identical to Advanced ──
  const handleTogglePlay = async()=>{
    if(isPlaying){
      // Pause — keep position, highlight current row
      pauseMetronome();
      setIsPlaying(false); setIsPaused(true);
      setCountIn(0); setCountInBeat(-1); return;
    }
    if(countIn>0){
      clearInterval(countInRef.current);
      setCountIn(0); setCountInBeat(-1);
      if(intervalRef.current) clearInterval(intervalRef.current);
      const ms16 = (60/bpmRef.current/4)*1000;
      intervalRef.current = setInterval(tick, ms16);
      tick();
      setIsPlaying(true); return;
    }
    if(isPaused){
      // Resume from current row with countdown
      const { secIdx, rowIdx } = playPosRef.current;
      setIsPaused(false);
      await startFromRow(secIdx, rowIdx); return;
    }
    await init();
    const ms = (60/bpmRef.current)*1000;
    let beat=4, beatIdx=0;
    setCountIn(beat); setCountInBeat(beatIdx); playChordClick(true);
    countInRef.current = setInterval(()=>{
      beat--; beatIdx+=2;
      if(beat<=0){
        clearInterval(countInRef.current);
        setCountIn(0); setCountInBeat(-1);
        playPosRef.current = { secIdx:0, rowIdx:0, beat:-1, pass:0 };
        setPlayPos({ secIdx:0, rowIdx:0, beat:-1, pass:0 });
        currentChordRef.current = null;
        if(intervalRef.current) clearInterval(intervalRef.current);
        const ms16 = (60/bpmRef.current/4)*1000;
        intervalRef.current = setInterval(tick, ms16);
        tick();
        setIsPlaying(true);
      } else {
        setCountIn(beat); setCountInBeat(beatIdx%8); playChordClick(false);
      }
    }, ms);
  };

  // ── Save / Load / Share state ──
  const [savedSongs, setSavedSongs] = useState(()=>{ try{ return JSON.parse(localStorage.getItem(STORAGE_KEYS.songs)||"[]"); } catch{ return []; } });
  const [showSaved, setShowSaved] = useState(false);
  const [savePrompt, setSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [loadedSongName, setLoadedSongName] = useState(null);
  const [songViewMode, setSongViewMode] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);

  // ── Encode / decode sections for URL ──
  const encodeSections = (secs) => secs.map(sec=>({
    n: sec.name,
    rp: sec.repeat||1,
    rows: sec.rows.map(r=>({
      sz: r.size,
      rp: r.repeat,
      sa: r.strumActive.reduce((acc,v,i)=>{ if(v) acc.push(i); return acc; },[]),
      bc: Object.fromEntries(r.blockChords.map((v,i)=>[i,v]).filter(([,v])=>v)),
      tx: r.text||undefined,
      ts: r.textSize!==23 ? r.textSize : undefined,
    }))
  }));

  const decodeSections = (encoded) => encoded.map(sec=>({
    id: Date.now()+Math.random(),
    name: sec.n||"Section",
    repeat: sec.rp||1,
    rows: sec.rows.map(r=>{
      const strumActive = Array(r.sz||8).fill(false);
      (r.sa||[]).forEach(i=>{ strumActive[i]=true; });
      const blockChords = Array(r.sz||8).fill(null);
      Object.entries(r.bc||{}).forEach(([i,v])=>{ blockChords[Number(i)]=v; });
      return { id:Date.now()+Math.random(), size:r.sz||8, repeat:r.rp||1, strumActive, blockChords, text:r.tx||"", textSize:r.ts||23 };
    })
  }));

  const doSave = () => {
    if(!saveName.trim()) return;
    const song = { id:Date.now(), name:saveName.trim(), sections:encodeSections(sections), bpm, capo, scrollSpeed, savedAt:new Date().toLocaleDateString() };
    const updated = [...savedSongs, song];
    setSavedSongs(updated);
    try{ localStorage.setItem(STORAGE_KEYS.songs, JSON.stringify(updated)); } catch(e){}
    setSavePrompt(false); setSaveName(""); setShowSaved(true); setLoadedSongName(song.name);
  };

  const doLoad = (song) => {
    if(isPlaying){ stopMetronome(); setIsPlaying(false); }
    setSections(decodeSections(song.sections));
    setBpm(song.bpm||80); setCapo(song.capo||0);
    setScrollSpeed(song.scrollSpeed||0);
    setLoadedSongName(song.name); setShowSaved(false); setSongViewMode(false);
    window.scrollTo(0,0);
  };

  const doDelete = (id) => {
    const updated = savedSongs.filter(s=>s.id!==id);
    setSavedSongs(updated);
    try{ localStorage.setItem(STORAGE_KEYS.songs, JSON.stringify(updated)); } catch(e){}
  };

  const doShare = async (song) => {
    try {
      const payload = { n:song.name, secs:song.sections, b:song.bpm, c:song.capo||0, ss:song.scrollSpeed||0 };
      const id = await supabaseInsert(song.name, payload);
      const url = `${window.location.origin}${window.location.pathname}?id=${id}`;
      navigator.clipboard.writeText(url)
        .then(()=>alert(`✅ Link copied!\n\n"${song.name}" is now shareable at:\n${url}`))
        .catch(()=>prompt("Copy this link:", url));
    } catch(e){ 
      console.error(e);
      alert("Couldn't generate share link. Check your connection and try again.");
    }
  };

  // ── Load from URL on mount ──
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const encoded = params.get("song");

    if(id) {
      // New Supabase short link
      supabaseFetch(id).then(row => {
        if(!row) return;
        const d = row.data;
        if(d.secs) setSections(decodeSections(d.secs));
        if(d.b) setBpm(d.b);
        if(d.c) setCapo(d.c);
        if(d.ss !== undefined) setScrollSpeed(d.ss);
        setLoadedSongName(d.n||row.name||"Shared Song");
        setSongViewMode(true);
        window.history.replaceState({}, "", window.location.pathname);
        window.scrollTo(0,0);
      }).catch(e=>console.error("Failed to load song:", e));
    } else if(encoded) {
      // Legacy ?song= URL
      try {
        const d = JSON.parse(atob(encoded));
        if(d.secs) setSections(decodeSections(d.secs));
        if(d.b) setBpm(d.b);
        if(d.c) setCapo(d.c);
        if(d.ss !== undefined) setScrollSpeed(d.ss);
        setLoadedSongName(d.n||"Shared Song");
        setSongViewMode(true);
        window.history.replaceState({}, "", window.location.pathname);
        window.scrollTo(0,0);
      } catch(e){}
    }
  },[]);

  // ── Section ops ──
  const addSection = ()=>setSections(s=>[...s,makeSection(`Section ${s.length+1}`)]);
  const deleteSection = (id)=>setSections(s=>s.filter(x=>x.id!==id));
  const copySection = (id)=>{
    setSections(s=>{
      const idx=s.findIndex(x=>x.id===id), orig=s[idx];
      const copy={...orig, id:Date.now()+Math.random(), name:orig.name+" (copy)",
        rows:orig.rows.map(r=>({...r,id:Date.now()+Math.random(),strumActive:[...r.strumActive],blockChords:[...r.blockChords]}))};
      const n=[...s]; n.splice(idx+1,0,copy); return n;
    });
  };
  const renameSection=(id,name)=>setSections(s=>s.map(x=>x.id!==id?x:{...x,name}));
  const repeatSection=(id)=>setSections(s=>s.map(x=>x.id!==id?x:{...x,repeat:((x.repeat||1)%8)+1}));
  const reorder=(from,to)=>{
    if(from===to||from===null||to===null) return;
    setSections(s=>{const n=[...s];const[item]=n.splice(from,1);n.splice(to,0,item);return n;});
  };

  // ── Row ops ──
  const updateRow=(secId,rowIdx,fn)=>setSections(s=>s.map(sec=>sec.id!==secId?sec:{...sec,rows:sec.rows.map((r,i)=>i!==rowIdx?r:fn(r))}));
  const addRow=(secId)=>setSections(s=>s.map(sec=>sec.id!==secId?sec:{...sec,rows:[...sec.rows,makeSongRow()]}));
  const copyRow=(secId,rowIdx)=>setSections(s=>s.map(sec=>{
    if(sec.id!==secId) return sec;
    const copy={...sec.rows[rowIdx],id:Date.now()+Math.random(),strumActive:[...sec.rows[rowIdx].strumActive],blockChords:[...sec.rows[rowIdx].blockChords]};
    const rows=[...sec.rows]; rows.splice(rowIdx+1,0,copy); return {...sec,rows};
  }));
  const removeRow=(secId,rowIdx)=>setSections(s=>s.map(sec=>sec.id!==secId?sec:{...sec,rows:sec.rows.filter((_,i)=>i!==rowIdx)}));

  const cycleSize=cycleRowSize;
  const sizeLabel=rowSizeLabel;

  const handleBlockClick=(secId,rowIdx,colIdx,inAssign)=>{
    if(inAssign){
      updateRow(secId,rowIdx,r=>{const bc=[...r.blockChords];bc[colIdx]=bc[colIdx]===assignChord?null:assignChord;return{...r,blockChords:bc};});
    } else {
      updateRow(secId,rowIdx,r=>{const sa=[...r.strumActive];sa[colIdx]=!sa[colIdx];return{...r,strumActive:sa};});
    }
  };

  const capoBtnStyle={width:22,height:22,borderRadius:6,border:"1px solid #333",background:"#1a1a1a",color:"#aaa",fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"};

  // VIEW MODE
  // ─────────────────────────────────────────────────────────────────────────
  if(songViewMode) return (
    <div style={{ width:"100%", paddingBottom:220 }}>

      {/* Song title */}
      <div style={{ textAlign:"center", paddingTop:24, paddingBottom:16 }}>
        <div style={{ fontSize:38, fontWeight:900, color:"#fff", letterSpacing:0.3, lineHeight:1.1, marginBottom:8 }}>
          {loadedSongName || "Song"}
        </div>
        {capo > 0 && <div style={{ fontSize:13, color:"#FFBE0B", fontWeight:700 }}>Capo {capo}</div>}
      </div>

      {/* Sticky section title */}
      <div style={{
        position:"sticky", top:0, zIndex:50,
        background:"rgba(6,6,5,0.97)", backdropFilter:"blur(12px)",
        borderBottom:"1px solid #1a1a1a",
        padding:"10px 16px", textAlign:"center", marginBottom:8,
      }}>
        <div style={{
          fontSize:22, fontWeight:900,
          color:(isPlaying||isPaused) ? "#FFBE0B" : "#fff",
          textShadow:(isPlaying||isPaused) ? "0 0 14px rgba(255,190,11,0.4)" : "none",
          transition:"color 0.3s, text-shadow 0.3s",
        }}>
          {sections[playPos.secIdx]?.name || sections[0]?.name || ""}
        </div>
      </div>

      {/* Flat row list */}
      {sections.map((sec, secIdx) => (
        <div key={sec.id}>
          {secIdx > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px",
              opacity:(isPlaying||isPaused) && playPos.secIdx !== secIdx ? 0.3 : 1,
              transition:"opacity 0.4s" }}>
              <div style={{ flex:1, height:1, background:"#2a2a2a" }} />
              <div style={{ fontSize:12, fontWeight:800, color:"#555", letterSpacing:0.5 }}>{sec.name}</div>
              <div style={{ flex:1, height:1, background:"#2a2a2a" }} />
            </div>
          )}
          {sec.rows.map((row, rowIdx) => {
            const isActiveSection = (isPlaying||isPaused) && playPos.secIdx === secIdx;
            const isActiveRow = isActiveSection && playPos.rowIdx === rowIdx;
            const rowKey = `${sec.id}_${rowIdx}`;
            const rep = row.repeat || 1;
            const remaining = isActiveRow ? rep - playPos.pass : rep;
            return (
              <div key={row.id}
                ref={el => { rowDomRefs.current[rowKey] = el; }}
                style={{
                  padding:"4px 12px", position:"relative",
                  background: isActiveRow ? "rgba(255,190,11,0.04)" : "transparent",
                  borderLeft: isActiveRow ? "3px solid rgba(255,190,11,0.6)" : "3px solid transparent",
                  transition:"background 0.3s, border-color 0.3s",
                  opacity:(isPlaying||isPaused) && !isActiveSection ? 0.25 : 1,
                }}>
                {/* Lyrics above blocks, indented to align with block 1 */}
                {row.text && (
                  <div style={{
                    marginLeft:36, paddingTop:6, paddingBottom:2,
                    fontSize: row.textSize||23, color:"#fff", lineHeight:1.5,
                    whiteSpace:"pre", overflow:"hidden",
                    opacity: !showLyrics ? 0 : (isPlaying||isPaused) ? (isActiveRow ? 1 : 0.45) : 1,
                    transition:"opacity 0.3s",
                    pointerEvents: showLyrics ? "auto" : "none",
                  }}>{row.text}</div>
                )}
                {/* Countdown + blocks row */}
                <div style={{ display:"flex", alignItems:"center" }}>
                  <div style={{ width:36, flexShrink:0, textAlign:"center" }}>
                    {isActiveRow && (isPlaying||isPaused) && (
                      <span style={{ fontSize:18, fontWeight:900, color:"#fff",
                        textShadow:"0 0 8px rgba(255,255,255,0.4)", lineHeight:1 }}>
                        {remaining}×
                      </span>
                    )}
                  </div>
                  <div style={{ flex:1, overflowX:"auto", paddingTop:18, paddingBottom:10 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:3, flexWrap:"nowrap", width:"max-content" }}>
                      {Array(row.size).fill(null).map((_,colIdx)=>{
                        const ch = row.blockChords[colIdx];
                        const isBeat = isActiveRow && playPos.beat === colIdx;
                        const isCountGlow = countIn>0 && secIdx===countdownTargetRef.current.secIdx && rowIdx===countdownTargetRef.current.rowIdx && colIdx===countInBeat;
                        return (
                          <div key={colIdx} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                            {isCountGlow
                              ? <div style={{ width:40, height:40, borderRadius:10, display:"flex",
                                  alignItems:"center", justifyContent:"center",
                                  background:"rgba(200,30,30,0.35)", border:"2px solid rgba(220,50,50,0.6)",
                                  boxShadow:"0 0 12px rgba(220,50,50,0.4)" }}>
                                  <span style={{ color:"#fff", fontWeight:900, fontSize:18 }}>{countIn}</span>
                                </div>
                              : <BuildBlock dir={DIRS16[colIdx%8]} active={row.strumActive[colIdx]}
                                  beat={isBeat} assigned={!!ch} onClick={()=>startFromRow(secIdx, rowIdx)} />
                            }
                            <div style={{ fontSize:13, fontWeight:900, height:18, lineHeight:"18px",
                              color:ch?"#FFBE0B":"transparent",
                              textShadow:ch&&isActiveRow?"0 0 8px rgba(255,190,11,0.6)":"none",
                              transition:"text-shadow 0.2s" }}>{ch||"·"}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Save + Share + Show Builder */}
      <div style={{ display:"flex", gap:8, margin:"16px 0 8px" }}>
        <button onClick={()=>setSavePrompt(p=>!p)} style={{
          flex:1, padding:"10px", borderRadius:12,
          border:"1px solid #FFBE0B44", background:"rgba(255,190,11,0.07)",
          color:"#FFBE0B", fontSize:13, fontWeight:700, cursor:"pointer" }}>💾 Save</button>
        <button onClick={()=>{
          if(!loadedSongName) return;
          doShare({ name:loadedSongName, sections:encodeSections(sections), bpm, capo, scrollSpeed });
        }} style={{
          flex:1, padding:"10px", borderRadius:12,
          border:"1px solid #4a6aff44", background:"rgba(74,106,255,0.07)",
          color:"#6b9fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>🔗 Share</button>
      </div>
      {savePrompt && (
        <SavePrompt header="Name this song" placeholder="e.g. Country Roads..."
          value={saveName} onChange={setSaveName}
          onSave={doSave} onCancel={()=>{setSavePrompt(false);setSaveName("");}} />
      )}
      <button onClick={()=>setSongViewMode(false)} style={{
        width:"100%", padding:"10px", borderRadius:12, border:"1px solid #2a2a2a",
        background:"transparent", color:"#555", fontSize:11, fontWeight:700,
        cursor:"pointer", letterSpacing:1, marginBottom:8 }}>▼ SHOW BUILDER</button>
      <div style={{ textAlign:"center", paddingBottom:8, color:"#333", fontSize:11 }}>
        © {new Date().getFullYear()} No Theory Club · All rights reserved.
      </div>

      {/* Fixed bottom bar */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0, zIndex:200,
        background:"rgba(6,6,5,0.97)", backdropFilter:"blur(16px)",
        borderTop:"1px solid rgba(255,190,11,0.18)",
        padding:"10px 16px 14px",
        boxShadow:"0 -8px 32px rgba(0,0,0,0.6)",
      }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <div style={{ fontSize:12, fontWeight:800, color:"#FFBE0B",
              whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"60%" }}>
              {loadedSongName || "Song"}
              {capo>0 && <span style={{ fontSize:10, color:"#888", marginLeft:6 }}>Capo {capo}</span>}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:11, color:"#555", fontWeight:700 }}>BPM</span>
              <span style={{ fontSize:15, fontWeight:900, color:"#FFBE0B" }}>{bpm}</span>
            </div>
          </div>
          <input type="range" min={20} max={160} value={bpm}
            onChange={e=>setBpm(Number(e.target.value))}
            style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
          <div style={{ display:"flex", gap:5, marginBottom:10 }}>
            {[40,60,80,100].map(b=>(
              <button key={b} onClick={()=>setBpm(b)} style={{
                flex:1, padding:"5px 0", borderRadius:8,
                border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
                background:bpm===b?"rgba(255,190,11,0.15)":"rgba(0,0,0,0.4)",
                color:bpm===b?"#FFBE0B":"#555", fontSize:11, fontWeight:700, cursor:"pointer" }}>{b}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"stretch" }}>
            <button onClick={handleTogglePlay} style={{
              flex:1, padding:"12px 8px", borderRadius:14, border:"none",
              background: countIn>0 ? "linear-gradient(135deg,#a06000,#c87800)"
                : isPlaying ? "linear-gradient(135deg,#a06000,#c87800)"
                : "linear-gradient(135deg,#1a6b3c,#27ae60)",
              color:"#fff", fontWeight:900, cursor:"pointer", transition:"all 0.15s",
              fontSize: countIn>0 ? 22 : 15,
              boxShadow: countIn>0 ? "0 4px 16px rgba(255,190,11,0.3)"
                : isPlaying ? "0 4px 16px rgba(231,76,60,0.4)" : "none" }}>
              {countIn>0
                ? <><div style={{fontSize:22,fontWeight:900,lineHeight:1}}>{countIn}</div><div style={{fontSize:10,opacity:0.75,marginTop:2}}>tap to skip</div></>
                : isPlaying ? "⏸ Pause" : isPaused ? "▶ Resume" : "▶ Play Song"}
            </button>
            <button onClick={()=>setMuteClick(m=>!m)} style={{
              padding:"12px 14px", borderRadius:12,
              border:muteClick?"2px solid #e74c3c":"1px solid #2a2a2a",
              background:muteClick?"rgba(231,76,60,0.12)":"rgba(0,0,0,0.4)",
              color:muteClick?"#e74c3c":"#666", fontSize:20, cursor:"pointer" }}>
              {muteClick?"🔇":"🔔"}
            </button>
            <button onClick={()=>setShowLyrics(l=>!l)} style={{
              padding:"12px 14px", borderRadius:12,
              border:showLyrics?"1px solid rgba(255,190,11,0.4)":"1px solid #2a2a2a",
              background:showLyrics?"rgba(255,190,11,0.1)":"rgba(0,0,0,0.4)",
              color:showLyrics?"#FFBE0B":"#555", fontSize:13, fontWeight:800,
              cursor:"pointer", letterSpacing:0.3 }}>
              {showLyrics ? "lyrics on" : "lyrics off"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ width:"100%", paddingBottom: assignSectionId ? 220 : 0 }}>

      {/* ── Top bar: Back to View + My Songs ── */}
      {(loadedSongName || savedSongs.length > 0) && (
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          {loadedSongName && (
            <button onClick={()=>{ setSongViewMode(true); window.scrollTo(0,0); }} style={{
              flex:1, padding:"9px", borderRadius:10,
              border:"1px solid rgba(255,190,11,0.35)", background:"rgba(255,190,11,0.07)",
              color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              ▲ Back to View
            </button>
          )}
          <button onClick={()=>setShowSaved(s=>!s)} style={{
            flex:1, padding:"9px", borderRadius:10,
            border:"1px solid #2a2a2a", background:"#111",
            color:"#888", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            📂 My Songs ({savedSongs.length})
          </button>
        </div>
      )}
      {showSaved && (
        <div style={{ marginBottom:16, display:"flex", flexDirection:"column", gap:8 }}>
          {savedSongs.length===0 && <div style={{ textAlign:"center", color:"#444", fontSize:13, padding:"12px 0" }}>No saved songs yet</div>}
          {savedSongs.map(s=>(
            <div key={s.id} style={{ background:"#111", border:"1px solid #2a2a2a", borderRadius:14,
              padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#fff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</div>
                <div style={{ fontSize:11, color:"#555", marginTop:2 }}>{s.sections?.length||0} sections · {s.bpm} BPM · {s.savedAt}</div>
              </div>
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                <button onClick={()=>doLoad(s)} style={{ padding:"5px 10px", borderRadius:8, border:"none",
                  background:"linear-gradient(135deg,#FFBE0B,#F77F00)", color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                <button onClick={()=>doDelete(s.id)} style={{ padding:"5px 8px", borderRadius:8, border:"1px solid #333",
                  background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Global Controls ── */}
      <div style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:16, padding:"14px 16px", marginBottom:20 }}>
        <div style={{ fontSize:9, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:12 }}>GLOBAL CONTROLS</div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
          <span style={{ fontSize:11, color:"#888", fontWeight:700 }}>BPM</span>
          <span style={{ fontSize:14, fontWeight:900, color:"#FFBE0B" }}>{bpm}</span>
        </div>
        <input type="range" min={20} max={160} value={bpm} onChange={e=>setBpm(Number(e.target.value))}
          style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
        <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:12 }}>
          {[40,60,80,100].map(b=>(
            <button key={b} onClick={()=>setBpm(b)} style={{
              flex:1, padding:"5px 0", borderRadius:8,
              border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
              background:bpm===b?"rgba(255,190,11,0.15)":"#0a0a0a",
              color:bpm===b?"#FFBE0B":"#555", fontSize:11, fontWeight:700, cursor:"pointer" }}>{b}</button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, background:"#111", border:"1px solid #2a2a2a", borderRadius:10, padding:"6px 10px" }}>
            <span style={{ fontSize:11, color:"#555", fontWeight:700 }}>CAPO</span>
            <button onClick={()=>setCapo(c=>Math.max(0,c-1))} style={capoBtnStyle}>−</button>
            <span style={{ fontSize:14, fontWeight:900, color:capo>0?"#FFBE0B":"#444", minWidth:14, textAlign:"center" }}>{capo}</span>
            <button onClick={()=>setCapo(c=>Math.min(7,c+1))} style={capoBtnStyle}>+</button>
          </div>
          {/* Autoscroll speed control */}
          <div style={{ display:"flex", alignItems:"center", gap:5,
            background:"#111", border:`1px solid ${scrollSpeed>0?"rgba(255,190,11,0.4)":"#2a2a2a"}`,
            borderRadius:10, padding:"6px 10px", transition:"border-color 0.2s" }}>
            <span style={{ fontSize:18, fontWeight:900, color:scrollSpeed>0?"#FFBE0B":"#555", lineHeight:1 }}>↕</span>
            <button onClick={()=>setScrollSpeed(s=>Math.max(0,s-1))} style={{...capoBtnStyle, opacity:scrollSpeed===0?0.3:1}}>−</button>
            <span style={{ fontSize:13, fontWeight:900, minWidth:16, textAlign:"center",
              color:scrollSpeed>0?"#FFBE0B":"#444" }}>{scrollSpeed}</span>
            <button onClick={()=>setScrollSpeed(s=>Math.min(10,s+1))} style={capoBtnStyle}>+</button>
          </div>
          <button onClick={()=>setMuteClick(m=>!m)} style={{
            padding:"8px 12px", borderRadius:10,
            border:muteClick?"2px solid #e74c3c":"1px solid #2a2a2a",
            background:muteClick?"rgba(231,76,60,0.1)":"#111",
            color:muteClick?"#e74c3c":"#666", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            {muteClick?"🔇":"🔔"}
          </button>
          <button onClick={handleTogglePlay} style={{
            flex:1, padding:"10px", borderRadius:12, border:"none",
            background:countIn>0?"linear-gradient(135deg,#a06000,#c87800)":isPlaying?"linear-gradient(135deg,#c0392b,#e74c3c)":"linear-gradient(135deg,#1a6b3c,#27ae60)",
            color:"#fff", fontSize:countIn>0?20:14, fontWeight:800, cursor:"pointer", transition:"all 0.15s",
            boxShadow:countIn>0?"0 4px 16px rgba(255,190,11,0.3)":isPlaying?"0 4px 16px rgba(231,76,60,0.4)":"0 4px 24px rgba(255,214,10,0.45)" }}>
            {countIn>0?<><div style={{fontSize:20,fontWeight:900,lineHeight:1}}>{countIn}</div><div style={{fontSize:9,opacity:0.75,marginTop:2}}>tap to skip</div></>:isPlaying?"⏸ Pause":isPaused?"▶ Resume":"▶ Play Song"}
          </button>
        </div>
      </div>

      {/* ── Sections ── */}
      {sections.map((sec,idx)=>{
        const isAssigning=assignSectionId===sec.id;
        return (
          <div key={sec.id}
            style={{ width:"100%", background:"#0a0a0a", borderRadius:18, marginBottom:14,
              border:`1px solid ${"#2a2a2a"}`,
              boxShadow:playPos.secIdx===idx&&(isPlaying||isPaused)?"0 0 14px rgba(255,190,11,0.15)":"none",
              transition:"box-shadow 0.3s" }}>

            {/* Section header */}
            <div style={{ padding:"12px 14px 8px", display:"flex", alignItems:"flex-start", gap:8, position:"relative" }}>

              {/* LEFT: Assign Chords + Section Play */}
              <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                <button onClick={()=>setAssignSectionId(isAssigning?null:sec.id)} style={{
                  padding:"6px 10px", borderRadius:8, border:"none", cursor:"pointer",
                  background:isAssigning?"rgba(255,190,11,0.18)":"rgba(255,255,255,0.06)",
                  color:isAssigning?"#FFBE0B":"#888", fontSize:11, fontWeight:800, letterSpacing:0.3,
                  boxShadow:isAssigning?"0 0 8px rgba(255,190,11,0.25)":"none",
                  transition:"all 0.15s" }}>
                  {isAssigning?"✕ Close":"✏️ Chords"}
                </button>
                <button onClick={()=>{
                  if(isPlaying&&(isPlaying||isPaused)&&playPos.secIdx===idx){ stopMetronome(); setIsPlaying(false); setIsPaused(false); }
                  else startFromSection(idx);
                }} style={{
                  padding:"6px 10px", borderRadius:8, border:"none", cursor:"pointer",
                  background: (isPlaying||isPaused)&&playPos.secIdx===idx
                    ? "rgba(231,76,60,0.15)"
                    : "rgba(39,174,96,0.12)",
                  color: (isPlaying||isPaused)&&playPos.secIdx===idx ? "#e74c3c" : "#27ae60",
                  fontSize:13, fontWeight:900, transition:"all 0.15s" }}>
                  {(isPlaying||isPaused)&&playPos.secIdx===idx ? "⏹" : "▶"}
                </button>
              </div>

              {/* CENTER: Title */}
              <div style={{ flex:1, textAlign:"center" }}>
                {editingId===sec.id
                  ? <input autoFocus value={editingName}
                      onChange={e=>setEditingName(e.target.value)}
                      onBlur={()=>{ renameSection(sec.id,editingName.trim()||sec.name); setEditingId(null); }}
                      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Escape"){ renameSection(sec.id,editingName.trim()||sec.name); setEditingId(null); }}}
                      style={{ textAlign:"center", background:"transparent", border:"none",
                        borderBottom:"1px solid #FFBE0B", color:"#fff", fontSize:16, fontWeight:900,
                        outline:"none", padding:"2px 8px", width:"100%" }} />
                  : <div onClick={()=>{ setEditingId(sec.id); setEditingName(sec.name); }}
                      style={{ fontSize:16, fontWeight:900, cursor:"text", lineHeight:1.3,
                        color:playPos.secIdx===idx&&isPlaying?"#FFBE0B":"#fff",
                        textShadow:playPos.secIdx===idx&&isPlaying?"0 0 12px rgba(255,190,11,0.5)":"none",
                        transition:"color 0.2s, text-shadow 0.2s" }}>
                      {sec.name}
                    </div>
                }
              </div>

              {/* RIGHT: Repeat + Move + Copy + Delete */}
              <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                <button onClick={()=>repeatSection(sec.id)} style={{
                  padding:"5px 9px", borderRadius:8,
                  border:(sec.repeat||1)>1?"1px solid rgba(255,190,11,0.5)":"1px solid #333",
                  background:(sec.repeat||1)>1?"rgba(255,190,11,0.12)":"#1a1a1a",
                  color:(sec.repeat||1)>1?"#FFBE0B":"#555",
                  fontSize:12, fontWeight:800, cursor:"pointer", minWidth:36 }}>
                  {sec.repeat||1}× 🔁
                </button>
                <button onClick={()=>setShowReorderModal(true)} title="Reorder sections" style={{
                  padding:"5px 10px", borderRadius:8, border:"1px solid #333",
                  background:"#1a1a1a", color:"#888", fontSize:15, cursor:"pointer",
                  fontWeight:700 }}>↕</button>
                <button onClick={()=>copySection(sec.id)} title="Duplicate section" style={{
                  padding:"5px 9px", borderRadius:8, border:"1px solid #333",
                  background:"#1a1a1a", color:"#888", fontSize:16, cursor:"pointer" }}>⧉</button>
                <button onClick={()=>deleteSection(sec.id)} title="Delete section" style={{
                  padding:"5px 9px", borderRadius:8, border:"1px solid #3a1a1a",
                  background:"#1a0a0a", color:"#e74c3c88", fontSize:16, cursor:"pointer" }}>✕</button>
              </div>
            </div>

            {/* Assign chord picker */}


            {/* Rows */}
            <div style={{ padding:"12px 14px" }}>
              {sec.rows.map((row,rowIdx)=>{
                const isActiveRow = (isPlaying||isPaused) && playPos.secIdx===idx && playPos.rowIdx===rowIdx;
                return (
                  <div key={row.id}
                    ref={el=>{ rowDomRefs.current[`${sec.id}_${rowIdx}`]=el; }}
                    style={{ marginBottom:rowIdx<sec.rows.length-1?14:0,
                      opacity: 1 }}>
                    {/* Row controls */}
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                      <span style={{ fontSize:9, color:isActiveRow?"#FFBE0B":"#444", letterSpacing:1, fontWeight:700, minWidth:32 }}>ROW {rowIdx+1}</span>
                      <button onClick={()=>updateRow(sec.id,rowIdx,r=>({...r,textOpen:!r.textOpen}))} style={{
                        padding:"4px 8px", borderRadius:7,
                        border: row.textOpen ? "1px solid rgba(255,190,11,0.4)" : "1px solid #2a2a2a",
                        background: row.textOpen ? "rgba(255,190,11,0.1)" : "transparent",
                        color: row.text ? "#FFBE0B" : row.textOpen ? "#FFBE0B" : "#444",
                        fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:0.3 }}>
                        {row.textOpen ? "▲ lyrics" : row.text ? "✎ lyrics" : "+ lyrics"}
                      </button>
                      <button onClick={()=>updateRow(sec.id,rowIdx,r=>({...r,size:cycleSize(r.size),strumActive:defaultBuild(cycleSize(r.size)),blockChords:Array(cycleSize(r.size)).fill(null)}))} style={{
                        padding:"6px 12px", borderRadius:8, border:"1px solid #333",
                        background:"#1a1a1a", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                        {sizeLabel(row.size)} ↻
                      </button>
                      <button onClick={()=>updateRow(sec.id,rowIdx,r=>({...r,repeat:r.repeat>=4?1:r.repeat+1}))} style={{
                        padding:"6px 12px", borderRadius:8, border:"1px solid #333",
                        background:row.repeat>1?"rgba(255,190,11,0.12)":"#1a1a1a",
                        color:row.repeat>1?"#FFBE0B":"#555", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                        {row.repeat}× 🔁
                      </button>
                      {sec.rows.length>1&&(
                        <button onClick={()=>removeRow(sec.id,rowIdx)} title="Remove row" style={{
                          padding:"6px 10px", borderRadius:8, border:"1px solid #3a1a1a",
                          background:"#1a0a0a", color:"#e74c3c88", fontSize:14, cursor:"pointer" }}>✕</button>
                      )}
                    </div>
                    {/* Blocks + Lyrics wrapper — same width */}
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                      {/* Lyrics text box — matches arrow row width */}
                      {row.textOpen && <div style={{ width: row.size * 40 + (row.size-1) * 5, maxWidth:"100%" }}>
                        {/* Font size controls */}
                        <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3, justifyContent:"flex-end" }}>
                          <span style={{ fontSize:10, color:"#444", letterSpacing:0.5 }}>A</span>
                          <button onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();updateRow(sec.id,rowIdx,r=>({...r,textSize:Math.max(10,( r.textSize||23)-1)}));}} style={{
                            width:20, height:20, borderRadius:5, border:"1px solid #333", background:"#1a1a1a",
                            color:"#888", fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>−</button>
                          <span style={{ fontSize:10, color:"#555", minWidth:18, textAlign:"center" }}>{row.textSize||23}</span>
                          <button onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();updateRow(sec.id,rowIdx,r=>({...r,textSize:Math.min(28,(r.textSize||23)+1)}));}} style={{
                            width:20, height:20, borderRadius:5, border:"1px solid #333", background:"#1a1a1a",
                            color:"#888", fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>+</button>
                          <span style={{ fontSize:12, color:"#555", letterSpacing:0.5 }}>A</span>
                        </div>
                        <textarea
                          value={row.text||""}
                          onChange={e=>updateRow(sec.id,rowIdx,r=>({...r,text:e.target.value}))}
                          onClick={e=>e.stopPropagation()}
                          onMouseDown={e=>e.stopPropagation()}
                          onDragStart={e=>e.preventDefault()}
                          onDrag={e=>e.preventDefault()}
                          onKeyDown={e=>{
                            if(e.key==='Tab'){
                              e.preventDefault();
                              const el=e.target, start=el.selectionStart, end=el.selectionEnd;
                              const spaces='        '; // 8 spaces
                              const newVal=el.value.substring(0,start)+spaces+el.value.substring(end);
                              updateRow(sec.id,rowIdx,r=>({...r,text:newVal}));
                              requestAnimationFrame(()=>{ el.selectionStart=el.selectionEnd=start+spaces.length; });
                            }
                          }}
                          placeholder="Lyrics / notes..."
                          rows={1}
                          style={{
                            width:"100%", marginBottom:4,
                            background:"rgba(255,255,255,0.06)",
                            border:"1px solid #383838", borderRadius:8,
                            color:"#ddd", fontSize:row.textSize||23, lineHeight:1.55,
                            padding:"6px 10px", resize:"none",
                            outline:"none", fontFamily:"inherit",
                            boxSizing:"border-box", cursor:"text",
                            userSelect:"text", WebkitUserSelect:"text",
                          }}
                        />
                      </div>}
                      <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"nowrap" }}>
                      {Array(row.size).fill(null).map((_,colIdx)=>{
                        const ch=row.blockChords[colIdx];
                        const isBeat=isActiveRow&&playPos.beat===colIdx;
                        const isCountGlow=countIn>0&&rowIdx===0&&idx===0&&colIdx===countInBeat;
                        return (
                          <div key={colIdx} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                            {isCountGlow
                              ? <div style={{ width:40, height:40, borderRadius:10,
                                  display:"flex", alignItems:"center", justifyContent:"center",
                                  background:"rgba(200,30,30,0.35)", border:"2px solid rgba(220,50,50,0.6)",
                                  boxShadow:"0 0 12px rgba(220,50,50,0.4)", transition:"all 0.05s" }}>
                                  <span style={{ color:"#fff", fontWeight:900, fontSize:18 }}>{countIn}</span>
                                </div>
                              : <BuildBlock dir={DIRS16[colIdx%8]} active={row.strumActive[colIdx]}
                                  beat={isBeat} assigned={!!ch}
                                  onClick={()=>handleBlockClick(sec.id,rowIdx,colIdx,isAssigning)} />
                            }
                            <div style={{ fontSize:13, fontWeight:900, height:18, lineHeight:"18px",
                              color:ch?"#FFBE0B":"transparent",
                              textShadow:ch&&isActiveRow?"0 0 8px rgba(255,190,11,0.6)":"none" }}>{ch||"·"}</div>
                          </div>
                        );
                      })}
                      </div>
                    </div>{/* end blocks+lyrics wrapper */}
                  </div>
                );
              })}
              <div style={{ display:"flex", gap:8, marginTop:12 }}>
                <button onClick={()=>addRow(sec.id)} style={{
                  flex:2, padding:"9px", borderRadius:10,
                  border:"1px dashed #FFBE0B", background:"rgba(255,190,11,0.06)",
                  color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Add Row</button>
                <button onClick={()=>copyRow(sec.id, sec.rows.length-1)} style={{
                  flex:2, padding:"9px", borderRadius:10,
                  border:"1px dashed #666", background:"rgba(255,255,255,0.03)",
                  color:"#888", fontSize:12, fontWeight:700, cursor:"pointer" }}>⧉ Copy Row</button>
                <button onClick={()=>setSections(s=>s.map(x=>x.id!==sec.id?x:{...x,rows:[makeSongRow()]}))} style={{
                  flex:1, padding:"9px", borderRadius:10,
                  border:"1px solid #2a2a2a", background:"transparent",
                  color:"#555", fontSize:12, cursor:"pointer" }}>Reset</button>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Hide builder (back to view) ── */}
      {loadedSongName && (
        <button onClick={()=>setSongViewMode(true)} style={{
          width:"100%", padding:"10px", borderRadius:12, border:"1px solid #2a2a2a",
          background:"transparent", color:"#555", fontSize:11, fontWeight:700,
          cursor:"pointer", letterSpacing:1, marginBottom:12 }}>▲ BACK TO VIEW</button>
      )}

      <button onClick={addSection} style={{
        width:"100%", padding:"12px", borderRadius:14,
        border:"1px dashed #FFBE0B", background:"rgba(255,190,11,0.06)",
        color:"#FFBE0B", fontSize:13, fontWeight:700, cursor:"pointer", marginBottom:16 }}>
        + Add Section
      </button>

      {/* ── Save / Load / Share ── */}
      {loadedSongName && (
        <div style={{ textAlign:"center", marginBottom:10 }}>
          <span style={{ fontSize:11, color:"#555" }}>Editing: </span>
          <span style={{ fontSize:13, fontWeight:800, color:"#FFBE0B" }}>{loadedSongName}</span>
        </div>
      )}
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <button onClick={()=>setSavePrompt(p=>!p)} style={{
          flex:1, padding:"10px", borderRadius:12,
          border:"1px solid #FFBE0B44", background:"rgba(255,190,11,0.07)",
          color:"#FFBE0B", fontSize:13, fontWeight:700, cursor:"pointer" }}>💾 Save Song</button>
        <button onClick={()=>setShowSaved(s=>!s)} style={{
          flex:1, padding:"10px", borderRadius:12,
          border:"1px solid #2a2a2a", background:"#111",
          color:"#888", fontSize:13, fontWeight:700, cursor:"pointer" }}>
          📂 My Songs ({savedSongs.length})
        </button>
      </div>

      {savePrompt && (
        <SavePrompt header="Name this song" placeholder="e.g. Country Roads, Chorus Draft..."
          value={saveName} onChange={setSaveName}
          onSave={doSave} onCancel={()=>{setSavePrompt(false);setSaveName("");}} />
      )}

      {showSaved && (
        <div style={{ marginBottom:16, display:"flex", flexDirection:"column", gap:8 }}>
          {savedSongs.length===0 && (
            <div style={{ textAlign:"center", color:"#444", fontSize:13, padding:"16px 0" }}>
              No saved songs yet — build something and hit 💾
            </div>
          )}
          {savedSongs.map(s=>(
            <div key={s.id} style={{ background:"#111", border:"1px solid #2a2a2a",
              borderRadius:14, padding:"12px 14px",
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:800, color:"#fff",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</div>
                <div style={{ fontSize:11, color:"#555", marginTop:2 }}>
                  {s.sections?.length||0} sections · {s.bpm} BPM{s.capo>0?` · Capo ${s.capo}`:""} · {s.savedAt}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                <button onClick={()=>doLoad(s)} style={{
                  padding:"6px 12px", borderRadius:8, border:"none",
                  background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                  color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                <button onClick={()=>doShare(s)} style={{
                  padding:"6px 10px", borderRadius:8, border:"1px solid #333",
                  background:"transparent", color:"#6b9fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>🔗</button>
                <button onClick={()=>doDelete(s.id)} style={{
                  padding:"6px 10px", borderRadius:8, border:"1px solid #333",
                  background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ textAlign:"center", paddingBottom:8, color:"#333", fontSize:11 }}>
        © {new Date().getFullYear()} No Theory Club · All rights reserved.
      </div>

      {/* ── FIXED CHORD PICKER PANEL ── */}
      {assignSectionId && (
        <div style={{
          position:"fixed", bottom:0, left:0, right:0, zIndex:300,
          background:"rgba(6,6,5,0.98)", backdropFilter:"blur(16px)",
          borderTop:"2px solid rgba(255,190,11,0.35)",
          padding:"10px 16px 16px",
          boxShadow:"0 -8px 32px rgba(0,0,0,0.7)",
        }}>
          <div style={{ maxWidth:560, margin:"0 auto" }}>
            {/* Header */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ fontSize:11, color:"#888", letterSpacing:1 }}>
                ASSIGNING TO <span style={{ color:"#FFBE0B", fontWeight:800 }}>
                  {sections.find(s=>s.id===assignSectionId)?.name||""}
                </span>
              </div>
              <button onClick={()=>setAssignSectionId(null)} style={{
                background:"none", border:"none", color:"#555", fontSize:18,
                cursor:"pointer", padding:"2px 6px" }}>✕</button>
            </div>
            {/* Category tabs */}
            <div style={{ display:"flex", gap:5, marginBottom:8, flexWrap:"wrap" }}>
              {["all","7","sus","add","/"].map(cat=>(
                <button key={cat} onClick={()=>setCategoryFilter(cat)} style={{
                  padding:"5px 12px", borderRadius:8,
                  border:categoryFilter===cat?"2px solid #FFBE0B":"1px solid #2a2a2a",
                  background:categoryFilter===cat?"rgba(255,190,11,0.15)":"rgba(0,0,0,0.4)",
                  color:categoryFilter===cat?"#FFBE0B":"#555",
                  fontSize:12, fontWeight:800, cursor:"pointer" }}>
                  {cat==="all"?"Basic":cat}
                </button>
              ))}
              <div style={{ marginLeft:"auto", fontSize:11, color:"#555", alignSelf:"center" }}>
                Tap block → assign <span style={{color:"#FFBE0B"}}>{assignChord}</span>
              </div>
            </div>
            {/* Chord grid */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
              {(categoryFilter==="all"?ALL_CHORDS:CHORD_CATEGORIES[categoryFilter]||[]).map(c=>(
                <button key={c} onClick={()=>setAssignChord(c)} style={{
                  padding:"9px 4px", borderRadius:8, border:"none",
                  background:assignChord===c?"linear-gradient(135deg,#FFBE0B,#F77F00)":"rgba(28,28,28,0.9)",
                  color:assignChord===c?"#111":"#888",
                  fontSize:12, fontWeight:800, cursor:"pointer",
                  boxShadow:assignChord===c?"0 0 10px rgba(255,190,11,0.5)":"none",
                  transition:"all 0.1s" }}>{c}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── REORDER MODAL ── */}
      {showReorderModal && (
        <div onClick={()=>setShowReorderModal(false)} style={{
          position:"fixed", inset:0, zIndex:400,
          background:"rgba(0,0,0,0.85)", backdropFilter:"blur(6px)",
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:"24px 16px",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:"#111", border:"1px solid #2a2a2a", borderRadius:20,
            padding:"20px 16px", width:"100%", maxWidth:400,
            boxShadow:"0 24px 80px rgba(0,0,0,0.9)",
            maxHeight:"80vh", overflowY:"auto",
          }}>
            <div style={{ textAlign:"center", marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight:900, color:"#fff", marginBottom:4 }}>Reorder Sections</div>
              <div style={{ fontSize:11, color:"#555" }}>Drag sections into order</div>
            </div>
            {sections.map((sec, i)=>(
              <div key={sec.id}
                draggable
                onDragStart={()=>setModalDragIdx(i)}
                onDragOver={(e)=>{ e.preventDefault(); setModalDragOver(i); }}
                onDrop={()=>{
                  reorder(modalDragIdx, i);
                  setModalDragIdx(null); setModalDragOver(null);
                }}
                onDragEnd={()=>{ setModalDragIdx(null); setModalDragOver(null); }}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"12px 14px", borderRadius:12, marginBottom:8, cursor:"grab",
                  background: modalDragOver===i&&modalDragIdx!==i ? "rgba(255,190,11,0.12)" : "#1a1a1a",
                  border:`1px solid ${modalDragOver===i&&modalDragIdx!==i?"rgba(255,190,11,0.5)":"#2a2a2a"}`,
                  opacity: modalDragIdx===i ? 0.45 : 1,
                  transition:"opacity 0.1s, background 0.1s, border-color 0.1s",
                  userSelect:"none",
                }}>
                <span style={{ fontSize:18, color:"#555", lineHeight:1 }}>☰</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:800, color:"#fff" }}>{sec.name}</div>
                  <div style={{ fontSize:11, color:"#555", marginTop:2 }}>
                    {sec.rows.length} row{sec.rows.length!==1?"s":""}
                    {(sec.repeat||1)>1?` · ↻ ${sec.repeat}×`:""}
                  </div>
                </div>
                <span style={{ fontSize:12, color:"#333", fontWeight:700 }}>{i+1}</span>
              </div>
            ))}
            <button onClick={()=>setShowReorderModal(false)} style={{
              width:"100%", marginTop:8, padding:"12px", borderRadius:12, border:"none",
              background:"linear-gradient(135deg,#FFD60A,#F77F00)",
              color:"#111", fontSize:14, fontWeight:800, cursor:"pointer" }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SimpleBuildSong({ audio, chordVariants, updateVariant, sharedView=false }) {
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
    try{ return JSON.parse(localStorage.getItem(STORAGE_KEYS.strum)||"[]"); } catch{ return []; }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [savePrompt, setSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [capo, setCapo] = useState(0);
  const [countIn, setCountIn] = useState(0);

  const intervalRef = useRef(null);
  const countInIntervalRef = useRef(null);
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
  const capoRef = useRef(0);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ bpcRef.current=beatsPerChord; },[beatsPerChord]);
  useEffect(()=>{ chordsRef.current=songChords; },[songChords]);
  useEffect(()=>{ strumRef.current=strumActive; },[strumActive]);
  useEffect(()=>{
    row1SizeRef.current=row1Size; row2SizeRef.current=row2Size;
    hasSecondRowRef.current=hasSecondRow;
    totalStrumRef.current=hasSecondRow?row1Size+row2Size:row1Size;
  },[row1Size,row2Size,hasSecondRow]);
  useEffect(()=>{ capoRef.current=capo; },[capo]);

  // Load from URL on mount
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("strumprog");
    if(encoded){
      const d = decodeStrumDrill(encoded);
      if(d){
        setSongChords(d.songChords); setStrumActive(d.strumActive);
        setHasSecondRow(d.hasSecondRow); setRow1Size(d.row1Size); setRow2Size(d.row2Size);
        setBpm(d.bpm); setBeatsPerChord(d.beatsPerChord); setCapo(d.capo||0);
        setLoadedName(d.name); setSaveName(d.name);
        setPickerOpen(false);
        if(d.chordVariants) Object.entries(d.chordVariants).forEach(([c,v])=>updateVariant(c,v));
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
    // Bar boundary = start of row 1 OR start of row 2 (each row = 1 bar)
    const isBarStart = nextRaw===0 || (has2 && nextRaw===r1);
    if(isBarStart && !firstTickRef.current){
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
      if(currentChord) playChordStrum(getAudioKey(currentChord, chordVariants), isDown, capoRef.current);
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
  useEffect(()=>()=>{ clearInterval(intervalRef.current); clearInterval(countInIntervalRef.current); },[]);

  const doSave = () => {
    if(!saveName.trim()) return;
    const pattern = { id:Date.now(), name:saveName.trim(),
      strumActive, hasSecondRow, row1Size, row2Size,
      songChords, bpm, beatsPerChord, capo,
      chordVariants: {...chordVariants},
      savedAt:new Date().toLocaleDateString() };
    const updated = [...savedPatterns, pattern];
    setSavedPatterns(updated);
    localStorage.setItem(STORAGE_KEYS.strum, JSON.stringify(updated));
    setSavePrompt(false); setSaveName(""); setShowSaved(true);
  };

  const doShare = (p) => {
    try {
      const sizes = p.hasSecondRow ? [p.row1Size||8, p.row2Size||8] : [p.row1Size||8];
      const encoded = encodeStrumDrill(p.name, p.strumActive, sizes, p.songChords, p.bpm, p.beatsPerChord, p.chordVariants||{}, p.capo||0);
      const url = `${window.location.origin}${window.location.pathname}?strumprog=${encoded}`;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(url)
          .then(()=>alert(`✅ Link copied!\n\nShare "${p.name}" with your members.`))
          .catch(()=>prompt("Copy this link:", url));
      } else { prompt("Copy this link:", url); }
    } catch(e) { alert("Couldn't generate link."); }
  };

  const canPlay = songChords.length>=1;
  const nextChordIndex = songChords.length>0?(chordIndex+1)%songChords.length:0;
  const isLastBeat = isPlaying&&beatCount===beatsPerChord-1;

  const handleTogglePlay = async()=>{
    if(isPlaying){ stopMetronome(); setIsPlaying(false); return; }
    if(countIn>0){
      clearInterval(countInIntervalRef.current);
      setCountIn(0);
      startMetronome(); setIsPlaying(true);
      return;
    }
    if(!canPlay) return;
    await init();
    const ms=(60/bpmRef.current)*1000;
    let beat=4;
    setCountIn(beat); playChordClick(true);
    countInIntervalRef.current=setInterval(()=>{
      beat--;
      if(beat<=0){
        clearInterval(countInIntervalRef.current);
        setCountIn(0);
        startMetronome(); setIsPlaying(true);
      } else {
        setCountIn(beat); playChordClick(false);
      }
    }, ms);
  };

  const cycleSize = cycleRowSize;
  const sizeLabel = rowSizeLabel;

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

          {/* Capo badge */}
          {capo>0 && (
            <div style={{ width:"100%", display:"flex", justifyContent:"center", marginBottom:14 }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:6,
                padding:"6px 14px", borderRadius:20,
                background:"rgba(255,190,11,0.12)", border:"1px solid rgba(255,190,11,0.4)" }}>
                <span style={{ fontSize:14 }}>🎸</span>
                <span style={{ fontSize:13, fontWeight:800, color:"#FFBE0B", letterSpacing:0.5 }}>
                  CAPO ON FRET {capo}
                </span>
              </div>
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
            borderRadius:20, padding:"14px 10px", marginBottom:16 }}>
            <div style={{ fontSize:9, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:12 }}>STRUMMING PATTERN</div>
            <div style={{ display:"flex", gap:4, justifyContent:"center", flexWrap:"nowrap", marginBottom: hasSecondRow ? 10 : 0 }}>
              {Array(row1Size).fill(null).map((_,i)=>(
                <div key={i} style={{ flex:"1 1 0", minWidth:0, maxWidth:40, aspectRatio:"1/1", display:"flex" }}>
                  <BuildBlock dir={DIRS16[i%8]} active={strumActive[i]} beat={currentStrum===i&&isPlaying} onClick={()=>{}} fluid />
                </div>
              ))}
            </div>
            {hasSecondRow && (
              <div style={{ display:"flex", gap:4, justifyContent:"center", flexWrap:"nowrap", marginTop:8 }}>
                {Array(row2Size).fill(null).map((_,i)=>(
                  <div key={i+8} style={{ flex:"1 1 0", minWidth:0, maxWidth:40, aspectRatio:"1/1", display:"flex" }}>
                    <BuildBlock dir={DIRS16[i%8]} active={strumActive[i+8]} beat={currentStrum===i+8&&isPlaying} onClick={()=>{}} fluid />
                  </div>
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
            <input type="range" min={20} max={160} value={bpm}
              onChange={e=>setBpm(Number(e.target.value))}
              style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
            <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:10 }}>
              {[40,60,80,100].map(b=>(
                <button key={b} onClick={()=>setBpm(b)} style={{
                  flex:1, padding:"5px 0", borderRadius:8,
                  border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
                  background:bpm===b?"rgba(255,190,11,0.15)":"#0a0a0a",
                  color:bpm===b?"#FFBE0B":"#555", fontSize:11, fontWeight:700, cursor:"pointer" }}>{b}</button>
              ))}
            </div>
            <button onClick={handleTogglePlay} disabled={!canPlay&&countIn===0} style={{
              width:"100%", padding:"13px", borderRadius:12, border:"none",
              background:!canPlay?"#111":countIn>0?"linear-gradient(135deg,#a06000,#c87800)":isPlaying?"linear-gradient(135deg,#c0392b,#e74c3c)":"linear-gradient(135deg,#FFD60A,#F77F00)",
              color:!canPlay?"#333":"#fff",
              fontSize:countIn>0?22:17, fontWeight:900, cursor:canPlay||countIn>0?"pointer":"not-allowed",
              boxShadow:!canPlay?"none":countIn>0?"0 4px 16px rgba(255,190,11,0.3)":isPlaying?"0 4px 16px rgba(231,76,60,0.4)":"0 4px 24px rgba(255,214,10,0.4)",
              transition:"all 0.15s",
            }}>
              {!canPlay?"Select a chord to start":countIn>0?<><div style={{fontSize:22,fontWeight:900,lineHeight:1}}>{countIn}</div><div style={{fontSize:10,fontWeight:700,opacity:0.75,marginTop:3}}>tap to skip</div></>:isPlaying?"⏹ Stop":"▶ Play"}
            </button>
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
            <SavePrompt header="Name this pattern" placeholder="e.g. Verse loop..."
              value={saveName} onChange={setSaveName}
              onSave={doSave} onCancel={()=>{setSavePrompt(false);setSaveName("");}} />
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
                    <div style={{ fontSize:11, color:"#555", marginTop:2 }}>{p.bpm} BPM{p.capo>0?` · Capo ${p.capo}`:""} · {p.savedAt}</div>
                  </div>
                  <div style={{ display:"flex", gap:6, marginLeft:10 }}>
                    <button onClick={()=>{
                      if(isPlaying){stopMetronome();setIsPlaying(false);}
                      setSongChords(p.songChords||[]); setStrumActive(p.strumActive);
                      setHasSecondRow(p.hasSecondRow||false);
                      setRow1Size(p.row1Size||8); setRow2Size(p.row2Size||8);
                      setBpm(p.bpm); setBeatsPerChord(p.beatsPerChord||2); setCapo(p.capo||0);
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
                      localStorage.setItem(STORAGE_KEYS.strum, JSON.stringify(updated));
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
            allowDuplicates={true} onReset={()=>setLoadedName(null)} />

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
              <input type="range" min={20} max={160} value={bpm}
                onChange={e=>setBpm(Number(e.target.value))}
                style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
              <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:10 }}>
                {[40,60,80,100].map(b=>(
                  <button key={b} onClick={()=>setBpm(b)} style={{
                    flex:1, padding:"5px 0", borderRadius:8,
                    border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
                    background:bpm===b?"rgba(255,190,11,0.15)":"#0a0a0a",
                    color:bpm===b?"#FFBE0B":"#555", fontSize:11, fontWeight:700, cursor:"pointer" }}>{b}</button>
                ))}
              </div>
              <button onClick={handleTogglePlay} disabled={!canPlay&&countIn===0} style={{
                width:"100%", padding:"11px", borderRadius:12, border:"none",
                background:!canPlay?"#111":countIn>0?"linear-gradient(135deg,#a06000,#c87800)":isPlaying?"linear-gradient(135deg,#c0392b,#e74c3c)":"linear-gradient(135deg,#1a6b3c,#27ae60)",
                color:!canPlay?"#333":"#fff", fontSize:countIn>0?22:15, fontWeight:800,
                cursor:canPlay||countIn>0?"pointer":"not-allowed", transition:"all 0.15s",
                boxShadow:!canPlay?"none":countIn>0?"0 4px 16px rgba(255,190,11,0.3)":isPlaying?"0 4px 16px rgba(231,76,60,0.4)":"0 4px 16px rgba(39,174,96,0.4)",
              }}>
                {!canPlay?"Select a chord to start":countIn>0?<><div style={{fontSize:22,fontWeight:900,lineHeight:1}}>{countIn}</div><div style={{fontSize:10,fontWeight:700,opacity:0.75,marginTop:3}}>tap to skip</div></>:isPlaying?"⏹ Stop":"▶ Start"}
              </button>
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
              <div style={{ display:"flex", alignItems:"center", gap:6,
                background:"#111", border:"1px solid #2a2a2a", borderRadius:10, padding:"6px 10px" }}>
                <span style={{ fontSize:11, color:"#555", fontWeight:700 }}>CAPO</span>
                <button onClick={()=>setCapo(c=>Math.max(0,c-1))} style={{
                  width:22, height:22, borderRadius:6, border:"1px solid #333",
                  background:"#1a1a1a", color:"#aaa", fontSize:16, cursor:"pointer",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
                <span style={{ fontSize:14, fontWeight:900, color:capo>0?"#FFBE0B":"#444", minWidth:14, textAlign:"center" }}>{capo}</span>
                <button onClick={()=>setCapo(c=>Math.min(7,c+1))} style={{
                  width:22, height:22, borderRadius:6, border:"1px solid #333",
                  background:"#1a1a1a", color:"#aaa", fontSize:16, cursor:"pointer",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
              </div>
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
              <div style={{ display:"flex", gap:4, justifyContent:"center", flexWrap:"nowrap" }}>
                {Array(row1Size).fill(null).map((_,i)=>(
                  <div key={i} style={{ flex:"1 1 0", minWidth:0, maxWidth:40, aspectRatio:"1/1", display:"flex" }}>
                    <BuildBlock dir={DIRS16[i%8]} active={strumActive[i]} beat={currentStrum===i&&isPlaying} fluid
                      onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                        setStrumActive(p=>p.map((v,idx)=>idx===i?!v:v)); setStrumPatternBtn(null); }} />
                  </div>
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
                <div style={{ display:"flex", gap:4, justifyContent:"center", flexWrap:"nowrap" }}>
                  {Array(row2Size).fill(null).map((_,i)=>(
                    <div key={i+8} style={{ flex:"1 1 0", minWidth:0, maxWidth:40, aspectRatio:"1/1", display:"flex" }}>
                      <BuildBlock dir={DIRS16[i%8]} active={strumActive[i+8]} beat={currentStrum===i+8&&isPlaying} fluid
                        onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                          setStrumActive(p=>p.map((v,idx)=>idx===i+8?!v:v)); setStrumPatternBtn(null); }} />
                    </div>
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
              <SavePrompt header="Name this pattern" placeholder="e.g. Verse loop, Chorus..."
                value={saveName} onChange={setSaveName}
                onSave={doSave} onCancel={()=>{setSavePrompt(false);setSaveName("");}}
                wrapStyle={{ marginBottom:14 }} />
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
                        setBpm(p.bpm); setBeatsPerChord(p.beatsPerChord||2); setCapo(p.capo||0);
                        if(p.chordVariants) Object.entries(p.chordVariants).forEach(([c,v])=>updateVariant(c,v));
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
                        localStorage.setItem(STORAGE_KEYS.strum, JSON.stringify(updated));
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
function AdvancedBuildSong({ audio, chordVariants, updateVariant, sharedView=false }) {
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
  const viewScrollRef = useRef(null);
  const viewRowRefs = useRef([]);
  const viewInnerRef = useRef(null);
  const lastViewRowRef = useRef(-1);
  const [viewScrollOffset, setViewScrollOffset] = useState(0);
  const [savedPatterns, setSavedPatterns] = useState(()=>{
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.patterns)||"[]"); } catch{ return []; }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [savePrompt, setSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [builderOpen, setBuilderOpen] = useState(true);
  const [strumExpanded, setStrumExpanded] = useState(false);

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
  const countIntervalRef = useRef(null);

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

  // Auto-scroll view mode strum panel using translateY — starts at row 2, stops at end
  useEffect(()=>{
    if(!isPlaying && countIn === 0) {
      setViewScrollOffset(0);
      lastViewRowRef.current = -1;
      return;
    }
    let activeRow = countIn > 0 ? 0 : -1;
    if(currentStrum >= 0) {
      let rem = countIn > 0 ? 0 : currentStrum;
      for(let r = 0; r < rowSizes.length; r++) {
        const rt = rowSizes[r] * (rowRepeats[r]||1);
        if(rem < rt) { activeRow = r; break; }
        rem -= rt;
      }
    }
    if(activeRow <= 0) {
      // Row 1 — no scroll, stay at top
      if(activeRow !== lastViewRowRef.current) {
        lastViewRowRef.current = activeRow;
        setViewScrollOffset(0);
      }
      return;
    }
    if(activeRow >= 0 && activeRow !== lastViewRowRef.current) {
      lastViewRowRef.current = activeRow;
      const rowEl = viewRowRefs.current[activeRow];
      const innerEl = viewInnerRef.current;
      const containerHeight = 290;
      if(rowEl && innerEl) {
        // offsetTop relative to inner wrapper (which has position:relative)
        const rowTop = rowEl.offsetTop;
        const totalContentHeight = innerEl.offsetHeight;
        const maxOffset = Math.max(0, totalContentHeight - containerHeight);
        // Keep active row ~20px from top, but never exceed maxOffset
        const target = Math.min(Math.max(0, rowTop - 20 + 8), maxOffset);
        setViewScrollOffset(target);
      }
    }
  },[currentStrum, isPlaying, countIn, builderOpen]);

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
    localStorage.setItem(STORAGE_KEYS.patterns, JSON.stringify(updated));
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
      setLoadedPatternName(d.n||"Shared Pattern");
      setSaveName(d.n||"Shared Pattern");
      setBuilderOpen(false);
      window.history.replaceState({}, "", window.location.pathname);
      window.scrollTo(0, 0);
    } catch(e) {}
  }, []);

  const handleDelete = (id) => {
    const updated = savedPatterns.filter(p=>p.id!==id);
    setSavedPatterns(updated);
    localStorage.setItem(STORAGE_KEYS.patterns, JSON.stringify(updated));
  };

  const handleTogglePlay = async()=>{
    if(isPlaying){
      stopMetronome(); setIsPlaying(false); setCountIn(0); setCountInBeat(-1);
    } else if(countIn>0){
      clearInterval(countIntervalRef.current);
      setCountIn(0); setCountInBeat(-1);
      startMetronome(); setIsPlaying(true);
    } else {
      await init();
      const ms = (60/bpm)*1000;
      let beat = 4, beatIdx = 0;
      setCountIn(beat); setCountInBeat(beatIdx); playChordClick(true);
      countIntervalRef.current = setInterval(()=>{
        beat--; beatIdx += 2;
        if(beat <= 0){
          clearInterval(countIntervalRef.current);
          setCountIn(0); setCountInBeat(-1);
          startMetronome(); setIsPlaying(true);
        } else {
          setCountIn(beat); setCountInBeat(beatIdx % 8); playChordClick(false);
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

  // ── Chord carousel computations ─────────────────────────────────────────
  const hasAnyChords = blockChords.some(Boolean);
  const _offsets = getRowOffsets(rowSizes);
  const _total = rowSizes.reduce((a,b,i)=>a+b*(rowRepeats[i]||1),0);

  // Map flat playback position → blockChords array index
  const flatToArrIdx = (flatPos) => {
    let rem = flatPos;
    for(let r = 0; r < rowSizes.length; r++) {
      const rt = rowSizes[r] * (rowRepeats[r]||1);
      if(rem < rt) return _offsets[r] + (rem % rowSizes[r]);
      rem -= rt;
    }
    return 0;
  };

  // Pre-play: find first and second distinct chords in playback sequence
  let _preFirst = null, _preNext = null;
  for(let f = 0; f < _total; f++) {
    const ch = blockChords[flatToArrIdx(f)];
    if(ch) {
      if(!_preFirst) _preFirst = ch;
      else if(ch !== _preFirst) { _preNext = ch; break; }
    }
  }

  // Live: next chord and how many blocks away
  let blocksUntilNext = Infinity;
  const nextChordLabel = (() => {
    if(_total === 0) return _preNext;
    if(!isPlaying || currentStrum < 0) return _preNext;
    for(let i = 1; i <= _total; i++) {
      const ch = blockChords[flatToArrIdx((currentStrum + i) % _total)];
      if(ch && ch !== currentChordLabel) { blocksUntilNext = i; return ch; }
    }
    return null;
  })();
  const prevChordLabel = (() => {
    if(!isPlaying || currentStrum < 0) return null;
    for(let i = 1; i <= _total; i++) {
      const ch = blockChords[flatToArrIdx((currentStrum - i + _total) % _total)];
      if(ch && ch !== currentChordLabel) return ch;
    }
    return null;
  })();

  // Displayed carousel values (pre-play fallback to first chord)
  const carouselCurrent = (isPlaying || countIn > 0) ? (currentChordLabel || _preFirst) : _preFirst;
  const carouselNext    = (isPlaying || countIn > 0) ? nextChordLabel    : _preNext;
  const carouselPrev    = (isPlaying || countIn > 0) ? prevChordLabel    : null;
  const nextIsIncoming  = blocksUntilNext <= 3;

  return (
    <>
      {/* ── VIEW MODE (shared link) ──────────────────────────── */}
      {!builderOpen && (
        <>
          {/* Title */}
          {loadedPatternName && (
            <div style={{ width:"100%", textAlign:"center", marginBottom:14 }}>
              <div style={{ fontSize:22, fontWeight:900, color:"#fff", letterSpacing:0.3,
                textShadow:"0 2px 8px rgba(0,0,0,0.5)" }}>{loadedPatternName}</div>
            </div>
          )}

          {/* ── Chord Carousel Panel ── */}
          {hasAnyChords && (
            <div style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a",
              borderRadius:20, padding:"16px 14px", marginBottom:14 }}>
              <div style={{ fontSize:9, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:12 }}>CHORD</div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                {[
                  { chord: carouselPrev,    role: "prev" },
                  { chord: carouselCurrent, role: "active" },
                  { chord: carouselNext,    role: "next" },
                ].map(({ chord, role }, i) => {
                  const isActive   = role === "active";
                  const isNext     = role === "next";
                  const isIncoming = isNext && nextIsIncoming;
                  const img = chord ? getChordImg(chord, chordVariants) : null;
                  return (
                    <div key={role} style={{
                      flex: isActive ? "0 0 46%" : "0 0 27%",
                      display:"flex", flexDirection:"column", alignItems:"center",
                      opacity: isActive ? 1 : isIncoming ? 1 : 0.35,
                      transition:"opacity 0.25s",
                    }}>
                      <div style={{
                        width:"100%", borderRadius:10, overflow:"hidden", background:"#000",
                        border: isActive
                          ? "2px solid #FFBE0B"
                          : isIncoming
                            ? "2px solid rgba(255,190,11,0.7)"
                            : "1px solid #222",
                        boxShadow: isActive
                          ? "0 0 16px rgba(255,190,11,0.45)"
                          : isIncoming
                            ? "0 0 12px rgba(255,190,11,0.25)"
                            : "none",
                        transition:"border 0.2s, box-shadow 0.2s",
                      }}>
                        {img
                          ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
                              <img src={img} alt={chord} style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                            </div>
                          : <div style={{ aspectRatio:"3/4", display:"flex", alignItems:"center",
                              justifyContent:"center", fontSize: isActive ? 32 : 20, fontWeight:900,
                              color: isActive ? "#FFBE0B" : isIncoming ? "#FFD60A" : "#555" }}>
                              {chord || ""}
                            </div>
                        }
                      </div>
                      <div style={{ marginTop:4, fontSize: isActive ? 15 : 11, fontWeight:900,
                        color: isActive ? "#FFBE0B" : isIncoming ? "#FFD60A" : "#555",
                        transition:"all 0.2s" }}>{chord || ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Strum Pattern Panel ── */}
          <div style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a",
            borderRadius:20, padding:"16px", marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ width:40 }} />
              <div style={{ fontSize:9, color:"#555", letterSpacing:2 }}>STRUMMING PATTERN</div>
              <button onClick={()=>setStrumExpanded(e=>!e)} style={{
                padding:"7px 14px", borderRadius:10, border:"1px solid #FFBE0B44",
                background:"rgba(255,190,11,0.07)", color:"#FFBE0B", fontSize:12, fontWeight:700,
                cursor:"pointer", letterSpacing:0.5,
              }}>{strumExpanded ? "⊟ Collapse" : "⊞ Expand"}</button>
            </div>

            {/* ── COMPACT: 3-row scroll window ── */}
            {!strumExpanded && (
            <div ref={viewScrollRef} style={{ height:290, overflow:"hidden", position:"relative" }}>
              <div ref={viewInnerRef} style={{
                position:"relative",
                paddingTop:8,
                transform:`translateY(-${viewScrollOffset}px)`,
                transition:"transform 0.55s ease",
              }}>
              {(()=>{
                const offsets = getRowOffsets(rowSizes);

                // Row state
                let activeRowIdx = -1;
                let incomingRowIdx = -1;
                if(countIn > 0) {
                  activeRowIdx = 0;
                } else if(isPlaying && currentStrum >= 0) {
                  let remaining = currentStrum;
                  for(let r = 0; r < rowSizes.length; r++) {
                    const rowTotal = rowSizes[r] * (rowRepeats[r]||1);
                    if(remaining < rowTotal) {
                      activeRowIdx = r;
                      if(remaining >= rowTotal - 3 && rowSizes.length > 1)
                        incomingRowIdx = (r + 1) % rowSizes.length;
                      break;
                    }
                    remaining -= rowTotal;
                  }
                }

                return rowSizes.map((rowSize, rowIdx)=>{
                  const offset = offsets[rowIdx];
                  const repeat = rowRepeats[rowIdx]||1;
                  const isActiveRow   = activeRowIdx === rowIdx;
                  const isIncomingRow = incomingRowIdx === rowIdx;
                  // Compute current pass within this row (0-indexed) when active
                  let currentPass = 0;
                  if(isActiveRow && isPlaying){
                    // Find how many beats into the row's repeated sequence we are
                    let cumBeats = 0;
                    for(let r=0;r<rowIdx;r++) cumBeats += rowSizes[r]*(rowRepeats[r]||1);
                    const beatsIntoRow = currentStrum - cumBeats;
                    if(beatsIntoRow>=0) currentPass = Math.floor(beatsIntoRow / rowSize);
                  }
                  const displayCount = isActiveRow && isPlaying ? (repeat - currentPass) : repeat;
                  const rowOpacity = (!isPlaying && countIn === 0)
                    ? 0.55
                    : rowIdx === activeRowIdx ? 1
                    : rowIdx === activeRowIdx + 1 ? 1
                    : rowIdx === activeRowIdx + 2 ? 0.75
                    : 0.28;
                  return (
                    <div key={rowIdx}
                      ref={el => { viewRowRefs.current[rowIdx] = el; }}
                      style={{ marginBottom:10, opacity:rowOpacity, transition:"opacity 0.5s ease" }}>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:3, justifyContent:"center", flexWrap:"nowrap" }}>
                        {/* Repeat label — counts down 4×→1× while row is active */}
                        <div style={{
                          flex:"0 0 auto",
                          width:"min(38px, 9vw)", height:40, display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize: isActiveRow ? "min(22px, 5.5vw)" : "min(17px, 4.5vw)", fontWeight:900,
                          color: isActiveRow ? "#FFBE0B" : "#F79200",
                          textShadow: isActiveRow ? "0 0 10px rgba(255,190,11,0.8)" : "none",
                          letterSpacing:0.5, transition:"all 0.3s",
                        }}>{displayCount}×</div>
                        {Array(rowSize).fill(null).map((_,colIdx)=>{
                          const i = offset+colIdx;
                          const isCountInGlow = countIn > 0 && rowIdx === 0 && colIdx === countInBeat;
                          return (
                            <div key={i} style={{ flex:"1 1 0", minWidth:0, maxWidth:40,
                              display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                              <div style={{ width:"100%", aspectRatio:"1/1", display:"flex" }}>
                                {isCountInGlow
                                  ? <div style={{ width:"100%", height:"100%", borderRadius:10,
                                      display:"flex", alignItems:"center", justifyContent:"center",
                                      background:"rgba(200,30,30,0.35)", border:"2px solid rgba(220,50,50,0.6)",
                                      boxShadow:"0 0 12px rgba(220,50,50,0.4)", transition:"all 0.05s" }}>
                                      <span style={{ color:"#fff", fontWeight:900, fontSize:"min(18px, 4.5vw)" }}>{countIn}</span>
                                    </div>
                                  : <BuildBlock dir={DIRS16[colIdx%8]} active={strumActive[i]}
                                      beat={currentFlatIdx===i&&isPlaying} assigned={!!blockChords[i]} fluid onClick={()=>{}} />
                                }
                              </div>
                              <div style={{ fontSize:"min(20px, 4.8vw)", fontWeight:900, height:22,
                                color:blockChords[i]?"#FFBE0B":"transparent",
                                opacity: blockChords[i] ? 0.9 : 0,
                                textShadow:blockChords[i]&&isActiveRow?"0 0 8px rgba(255,190,11,0.6)":"none",
                                transition:"opacity 0.25s",
                              }}>{blockChords[i]||"·"}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
              </div>{/* end inner translateY wrapper */}
            </div>
            )}{/* end compact */}

            {/* ── EXPANDED: full height, all rows visible ── */}
            {strumExpanded && (
              <div>
              {(()=>{
                const offsets = getRowOffsets(rowSizes);
                return rowSizes.map((rowSize, rowIdx)=>{
                  const offset = offsets[rowIdx];
                  const repeat = rowRepeats[rowIdx]||1;
                  // Compute active row for beat highlighting (no opacity dimming in expanded)
                  let activeRowIdx = -1;
                  if(countIn > 0) activeRowIdx = 0;
                  else if(isPlaying && currentStrum >= 0) {
                    let rem = currentStrum;
                    for(let r = 0; r < rowSizes.length; r++) {
                      const rt = rowSizes[r]*(rowRepeats[r]||1);
                      if(rem < rt){ activeRowIdx = r; break; }
                      rem -= rt;
                    }
                  }
                  const isActiveRow = activeRowIdx === rowIdx;
                  // Compute current pass (0-indexed) within this row when active
                  let currentPass = 0;
                  if(isActiveRow && isPlaying){
                    let cumBeats = 0;
                    for(let r=0;r<rowIdx;r++) cumBeats += rowSizes[r]*(rowRepeats[r]||1);
                    const beatsIntoRow = currentStrum - cumBeats;
                    if(beatsIntoRow>=0) currentPass = Math.floor(beatsIntoRow / rowSize);
                  }
                  const displayCount = isActiveRow && isPlaying ? (repeat - currentPass) : repeat;
                  return (
                    <div key={rowIdx} style={{ marginBottom:10 }}>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:3, justifyContent:"center", flexWrap:"nowrap" }}>
                        <div style={{
                          flex:"0 0 auto",
                          width:"min(38px, 9vw)", height:40, display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize: isActiveRow ? "min(22px, 5.5vw)" : "min(17px, 4.5vw)", fontWeight:900,
                          color: isActiveRow ? "#FFBE0B" : "#F79200",
                          textShadow: isActiveRow ? "0 0 10px rgba(255,190,11,0.8)" : "none",
                          letterSpacing:0.5, transition:"all 0.3s",
                        }}>{displayCount}×</div>
                        {Array(rowSize).fill(null).map((_,colIdx)=>{
                          const i = offset+colIdx;
                          const isCountInGlow = countIn > 0 && rowIdx === 0 && colIdx === countInBeat;
                          return (
                            <div key={i} style={{ flex:"1 1 0", minWidth:0, maxWidth:40,
                              display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                              <div style={{ width:"100%", aspectRatio:"1/1", display:"flex" }}>
                                {isCountInGlow
                                  ? <div style={{ width:"100%", height:"100%", borderRadius:10,
                                      display:"flex", alignItems:"center", justifyContent:"center",
                                      background:"rgba(200,30,30,0.35)", border:"2px solid rgba(220,50,50,0.6)",
                                      boxShadow:"0 0 12px rgba(220,50,50,0.4)", transition:"all 0.05s" }}>
                                      <span style={{ color:"#fff", fontWeight:900, fontSize:"min(18px, 4.5vw)" }}>{countIn}</span>
                                    </div>
                                  : <BuildBlock dir={DIRS16[colIdx%8]} active={strumActive[i]}
                                      beat={currentFlatIdx===i&&isPlaying} assigned={!!blockChords[i]} fluid onClick={()=>{}} />
                                }
                              </div>
                              <div style={{ fontSize:"min(20px, 4.8vw)", fontWeight:900, height:22,
                                color:blockChords[i]?"#FFBE0B":"transparent",
                                textShadow:blockChords[i]&&isActiveRow?"0 0 8px rgba(255,190,11,0.6)":"none",
                              }}>{blockChords[i]||"·"}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
              </div>
            )}{/* end expanded */}
          </div>

          {/* ── BPM + Play ── */}
          <div style={{ width:"100%", background:"#111", border:"1px solid #2a2a2a",
            borderRadius:14, padding:"14px", marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:12, fontWeight:700, color:"#888" }}>BPM</span>
              <span style={{ fontSize:14, fontWeight:900, color:"#FFBE0B" }}>{bpm}</span>
            </div>
            <input type="range" min={20} max={160} value={bpm} onChange={e=>setBpm(Number(e.target.value))}
              style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
            <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:10 }}>
              {[40,60,80,100].map(b=>(
                <button key={b} onClick={()=>setBpm(b)} style={{
                  flex:1, padding:"5px 0", borderRadius:8,
                  border:bpm===b?"1px solid #FFBE0B":"1px solid #2a2210",
                  background:bpm===b?"rgba(255,190,11,0.15)":"#0a0a0a",
                  color:bpm===b?"#FFBE0B":"#555", fontSize:11, fontWeight:700, cursor:"pointer" }}>{b}</button>
              ))}
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:10 }}>
              <button onClick={handleTogglePlay} style={{
                flex:1, padding:"11px", borderRadius:12, border:"none",
                background:countIn>0?"linear-gradient(135deg,#a06000,#c87800)":isPlaying?"linear-gradient(135deg,#c0392b,#e74c3c)":"linear-gradient(135deg,#1a6b3c,#27ae60)",
                color:"#fff", fontSize:countIn>0?22:15, fontWeight:800, cursor:"pointer", transition:"all 0.15s",
                boxShadow:countIn>0?"0 4px 16px rgba(255,190,11,0.3)":isPlaying?"0 4px 16px rgba(231,76,60,0.4)":"0 4px 16px rgba(39,174,96,0.4)",
              }}>
                {countIn>0?<><div style={{fontSize:22,fontWeight:900,lineHeight:1}}>{countIn}</div><div style={{fontSize:10,fontWeight:700,opacity:0.75,marginTop:3}}>tap to skip</div></>:isPlaying?"⏹ Stop":"▶ Start"}
              </button>
              <button onClick={()=>setMuteMetronome(m=>!m)} style={{
                padding:"11px 14px", borderRadius:12,
                border: muteMetronome?"2px solid #e74c3c":"1px solid #2a2a2a",
                background: muteMetronome?"rgba(231,76,60,0.1)":"#111",
                color: muteMetronome?"#e74c3c":"#666",
                fontSize:18, cursor:"pointer",
              }}>{muteMetronome?"🔇":"🔔"}</button>
            </div>
          </div>

          {/* ── Save ── */}
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <button onClick={()=>setSavePrompt(p=>!p)} style={{
              flex:1, padding:"10px", borderRadius:12,
              border:"1px solid #FFBE0B44", background:"rgba(255,190,11,0.07)",
              color:"#FFBE0B", fontSize:13, fontWeight:700, cursor:"pointer" }}>💾 Save to My Patterns</button>
          </div>
          {savePrompt && (
            <SavePrompt header="Name this pattern" placeholder="e.g. Verse riff, Intro loop..."
              value={saveName} onChange={setSaveName}
              onSave={handleSave} onCancel={()=>{setSavePrompt(false);setSaveName("");}} />
          )}

          {/* ── Show builder toggle ── */}
          <button onClick={()=>setBuilderOpen(true)} style={{
            width:"100%", padding:"8px", borderRadius:10, border:"1px solid #2a2a2a",
            background:"transparent", color:"#555", fontSize:11, fontWeight:700,
            cursor:"pointer", letterSpacing:1, marginBottom:8 }}>▼ SHOW BUILDER</button>
          <div style={{ textAlign:"center", paddingTop:8, paddingBottom:8, color:"#333", fontSize:11 }}>
            © {new Date().getFullYear()} No Theory Club · All rights reserved.
          </div>
        </>
      )}

      {/* ── FULL BUILDER ─────────────────────────────────────── */}
      {builderOpen && (
      <div style={{ paddingBottom: assignMode ? 220 : 0 }}>
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
          <input type="range" min={20} max={160} value={bpm}
            onChange={e=>setBpm(Number(e.target.value))}
            style={{ width:"100%", accentColor:"#FFBE0B", cursor:"pointer", marginBottom:8 }} />
          <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:10 }}>
            {[40,60,80,100].map(b=>(
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
            {countIn>0
              ? <><div style={{fontSize:22,fontWeight:900,lineHeight:1}}>{countIn}</div><div style={{fontSize:10,fontWeight:700,opacity:0.75,marginTop:3}}>tap to skip</div></>
              : isPlaying ? "⏹ Stop" : "▶ Start"
            }
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

        {/* Chord picker — fixed bottom panel when in assign mode */}
        {assignMode && (
          <div style={{
            position:"fixed", bottom:0, left:0, right:0, zIndex:300,
            background:"rgba(6,6,5,0.98)", backdropFilter:"blur(16px)",
            borderTop:"2px solid rgba(255,190,11,0.35)",
            padding:"10px 16px 16px",
            boxShadow:"0 -8px 32px rgba(0,0,0,0.7)",
          }}>
            <div style={{ maxWidth:560, margin:"0 auto" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <div style={{ fontSize:11, color:"#888", letterSpacing:1 }}>
                  ASSIGN CHORD · <span style={{ color:"#FFBE0B", fontWeight:800 }}>{assignChord}</span>
                </div>
                <button onClick={()=>setAssignMode(false)} style={{
                  background:"none", border:"none", color:"#555", fontSize:18, cursor:"pointer", padding:"2px 6px" }}>✕</button>
              </div>
              <div style={{ display:"flex", gap:5, marginBottom:8, flexWrap:"wrap" }}>
                {["all","7","sus","add","/"].map(cat=>(
                  <button key={cat} onClick={()=>setCategoryFilter(cat)} style={{
                    padding:"5px 12px", borderRadius:8,
                    border: categoryFilter===cat ? "2px solid #FFBE0B" : "1px solid #2a2a2a",
                    background: categoryFilter===cat ? "rgba(255,190,11,0.15)" : "rgba(0,0,0,0.4)",
                    color: categoryFilter===cat ? "#FFBE0B" : "#555",
                    fontSize:12, fontWeight:800, cursor:"pointer" }}>
                    {cat==="all" ? "Basic" : cat}
                  </button>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
                {(categoryFilter==="all" ? ALL_CHORDS : CHORD_CATEGORIES[categoryFilter]||[]).map(c=>(
                  <button key={c} onClick={()=>setAssignChord(c)} style={{
                    padding:"9px 4px", borderRadius:8, border:"none",
                    background: assignChord===c ? "linear-gradient(135deg,#FFBE0B,#F77F00)" : "rgba(28,28,28,0.9)",
                    color: assignChord===c ? "#111" : "#888",
                    fontSize:12, fontWeight:800, cursor:"pointer",
                    boxShadow: assignChord===c ? "0 0 10px rgba(255,190,11,0.5)" : "none",
                    transition:"all 0.1s" }}>{c}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {(() => {
          const offsets = getRowOffsets(rowSizes);
          const totalPlayBlocks = rowSizes.reduce((a,b,i)=>a+b*(rowRepeats[i]||1),0);

          // Which array indices are 1–2 flat steps ahead with a different chord (incoming)
          const incomingIndices = new Set();
          if(isPlaying && currentStrum >= 0 && totalPlayBlocks > 0) {
            for(let step = 1; step <= 3; step++) {
              const flatPos = (currentStrum + step) % totalPlayBlocks;
              let remaining = flatPos;
              for(let r = 0; r < rowSizes.length; r++) {
                const rowTotal = rowSizes[r] * (rowRepeats[r]||1);
                if(remaining < rowTotal) {
                  const arrayIdx = offsets[r] + (remaining % rowSizes[r]);
                  if(blockChords[arrayIdx] && blockChords[arrayIdx] !== currentChordLabel) {
                    incomingIndices.add(arrayIdx);
                  }
                  break;
                }
                remaining -= rowTotal;
              }
            }
          }

          return rowSizes.map((rowSize, rowIdx)=>{
            const offset = offsets[rowIdx];
            const repeat = rowRepeats[rowIdx]||1;
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
                    background: repeat>1 ? "rgba(255,190,11,0.15)" : "#1a1a1a",
                    color: repeat>1 ? "#FFBE0B" : "#555",
                    fontSize:12, fontWeight:700, cursor:"pointer", minWidth:54,
                  }}>{repeat}× 🔁</button>
                </div>
                <div style={{ display:"flex", gap:3, justifyContent:"center", flexWrap:"nowrap" }}>
                  {Array(rowSize).fill(null).map((_,colIdx)=>{
                    const i = offset+colIdx;
                    const assignedChord=blockChords[i];
                    const isCountInGlow = countIn>0 && rowIdx===0 && colIdx===countInBeat;
                    const isActive = isPlaying && i===currentFlatIdx && !!assignedChord;
                    const isIncoming = isPlaying && incomingIndices.has(i);
                    const chordColor = isActive ? "#FFBE0B" : isIncoming ? "#F79200" : "#FFBE0B";
                    const chordOpacity = isActive ? 1 : isIncoming ? 0.65 : isPlaying ? 0.28 : 0.75;
                    const chordGlow = isActive ? "0 0 10px rgba(255,190,11,0.7)"
                      : isIncoming ? "0 0 8px rgba(247,146,0,0.45)" : "none";
                    return (
                      <div key={i} style={{ flex:"1 1 0", minWidth:0, maxWidth:40,
                        display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <div style={{ width:"100%", aspectRatio:"1/1", display:"flex" }}>
                          {isCountInGlow
                            ? <div style={{ width:"100%", height:"100%", borderRadius:10,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                background:"rgba(200,30,30,0.35)", border:"2px solid rgba(220,50,50,0.6)",
                                boxShadow:"0 0 12px rgba(220,50,50,0.4)", transition:"all 0.05s" }}>
                                <span style={{ color:"#fff", fontWeight:900, fontSize:"min(18px, 4.5vw)" }}>{countIn}</span>
                              </div>
                            : <BuildBlock dir={DIRS16[colIdx%8]} active={strumActive[i]}
                                beat={currentFlatIdx===i&&isPlaying} fluid
                                assigned={!!assignedChord} onClick={()=>handleBlockClick(i)} />
                          }
                        </div>
                        <div style={{ fontSize:"min(20px, 4.8vw)", fontWeight:900, height:22,
                          color: assignedChord ? chordColor : "transparent",
                          opacity: assignedChord ? chordOpacity : 0,
                          textShadow: assignedChord ? chordGlow : "none",
                          letterSpacing:0.3,
                          transition:"opacity 0.25s, color 0.25s, text-shadow 0.25s",
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
          {rowSizes.length<30 && <button onClick={()=>{ setRowSizes(p=>[...p,8]); setRowRepeats(p=>[...p,1]); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
            padding:"8px 16px", borderRadius:10, border:"1px dashed #FFBE0B",
            background:"rgba(255,190,11,0.07)", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Add Row</button>}
          {rowSizes.length<30 && <button onClick={()=>{
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
          <SavePrompt header="Name your pattern" placeholder="e.g. Verse riff, Intro loop..."
            value={saveName} onChange={setSaveName}
            onSave={handleSave} onCancel={()=>{setSavePrompt(false);setSaveName("");}}
            wrapStyle={{ marginTop:14, marginBottom:0, padding:"16px" }}
            footer={
              <div style={{ fontSize:10, color:"#444", textAlign:"center", marginTop:8 }}>
                {savedPatterns.length}/20 slots used
              </div>
            } />
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
      {loadedPatternName && (
        <button onClick={()=>setBuilderOpen(false)} style={{
          width:"100%", padding:"8px", borderRadius:10, border:"1px solid #2a2a2a",
          background:"transparent", color:"#555", fontSize:11, fontWeight:700,
          cursor:"pointer", letterSpacing:1, marginBottom:16 }}>▲ HIDE BUILDER</button>
      )}
      </div>
      )}{/* end builderOpen */}
    </>
  );
}

// ─── SHARED UI COMPONENTS ────────────────────────────────────────────────────

function SectionHeader({ title, sub }) {
  return (
    <div style={{
      borderRadius:18, padding:"18px 24px",
      textAlign:"center", marginBottom:18, width:"100%",
      background:"#0e0b07", border:"1px solid #211b10",
      boxShadow:"0 6px 22px rgba(0,0,0,0.4)",
    }}>
      <h1 style={{ margin:0, fontSize:21, fontWeight:900, color:"#f3ead2", letterSpacing:0.3 }}>{title}</h1>
      <p style={{ margin:"6px 0 0", fontSize:12.5, color:"#8a7f5e", lineHeight:1.6 }}>{sub}</p>
    </div>
  );
}

const MODE_GRADIENTS = [
  "linear-gradient(135deg, #FFD60A, #FFBE0B)",
  "linear-gradient(135deg, #FFBE0B, #F79200)",
  "linear-gradient(135deg, #D4720A, #9A3E00)",
];

function ModeTabs({ options, value, onChange }) {
  return (
    <div style={{ display:"flex", gap:8, marginBottom:18, width:"100%" }}>
      {options.map(([m,label])=>{
        const on = value===m;
        return (
          <button key={m} onClick={()=>onChange(m)} style={{
            flex:1, padding:"13px 12px", borderRadius:14,
            border:`1px solid ${on ? "rgba(255,190,11,0.55)" : "#241d10"}`,
            background: on
              ? "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.16) 0%, rgba(255,170,30,0) 65%), #16110a"
              : "#100d09",
            color: on ? "#FFD60A" : "#8a7f5e",
            fontSize:14, fontWeight:900, letterSpacing:0.3,
            boxShadow: on ? "0 0 22px rgba(255,160,20,0.18)" : "none",
            cursor:"pointer", transition:"all 0.22s ease", fontFamily:"inherit",
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function ChordPickerPanel({ customChords, setCustomChords, maxChords, accentColor,
  isPlaying, stopMetronome, setIsPlaying, setChordIndex, setBeatCount, beatRef, chordRef,
  chordVariants, updateVariant, allowDuplicates=false, onReset }) {
  const [variantPickerChord, setVariantPickerChord] = useState(null);
  const [outsideKeyChord, setOutsideKeyChord] = useState(null);

  // In duplicate mode slots may be variant keys (e.g. "C/B"); reduce to base
  // chords for key detection and allowed-chord logic.
  const baseChords = allowDuplicates ? customChords.map(slotBase) : customChords;
  const uniqueChords = allowDuplicates ? [...new Set(baseChords)] : customChords;
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
          ? <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);} setCustomChords([]); setChordIndex(0); setBeatCount(0); if(beatRef)beatRef.current=0; if(chordRef)chordRef.current=0; onReset?.(); }} style={{ background:"none", border:"none", color:"#e74c3c", fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:0.5 }}>Reset</button>
          : <div style={{ width:32 }} />
        }
      </div>
      <div style={{ fontSize:12, color:"#555", textAlign:"center", marginBottom:14 }}>
        {customChords.length}/{maxChords} {allowDuplicates ? "slots used" : "selected"}
        {customChords.length>=1 && <span style={{ color:"#FFD166", marginLeft:8 }}>→ {(allowDuplicates?customChords.map(slotLabel):customChords).join(" → ")}</span>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
        {ALL_CHORDS.map(chord=>{
          const isSel = allowDuplicates ? baseChords.includes(chord) : customChords.includes(chord);
          const positions = allowDuplicates ? baseChords.reduce((a,c,i)=>c===chord?[...a,i+1]:a,[]) : [];
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
              {(allowDuplicates ? slotImg(chord) : getChordImg(chord, chordVariants))
                ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center", position:"relative" }}>
                    <img src={allowDuplicates ? slotImg(chord) : getChordImg(chord, chordVariants)} alt={chord}
                      style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                    {!allowDuplicates && HAS_VARIATIONS.has(chord) && (
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
      {/* Sequence chips — tap ⚙ to change voicing, × to remove */}
      {allowDuplicates && customChords.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:10, marginTop:2 }}>
          {customChords.map((c,i)=>{
            const base = slotBase(c);
            const isVar = base !== c;
            return (
              <div key={i} style={{
                display:"flex", alignItems:"center", gap:4, padding:"4px 6px 4px 10px",
                borderRadius:20, background:"rgba(255,190,11,0.1)",
                border:"1px solid rgba(255,190,11,0.3)", fontSize:12, fontWeight:800,
                color:"#FFBE0B",
              }}>
                <span style={{ fontSize:9, color:"#888", marginRight:1 }}>{i+1}</span>
                {slotLabel(c)}
                {HAS_VARIATIONS.has(base) && (
                  <button onClick={()=>setVariantPickerChord({ idx:i, base, current:c })}
                    style={{ background:"none", border:"none",
                      color:isVar?"#FFBE0B":"#888", fontSize:11, cursor:"pointer",
                      padding:"0 1px", lineHeight:1 }}>⚙</button>
                )}
                <button onClick={()=>{
                  if(isPlaying){stopMetronome();setIsPlaying(false);}
                  const next=[...customChords]; next.splice(i,1);
                  setCustomChords(next); setChordIndex(0); setBeatCount(0);
                  if(beatRef)beatRef.current=0; if(chordRef)chordRef.current=0;
                }} style={{ background:"none", border:"none", color:"#666",
                  fontSize:12, cursor:"pointer", padding:"0 0 0 2px", lineHeight:1 }}>×</button>
              </div>
            );
          })}
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
          chord={typeof variantPickerChord==="object" ? variantPickerChord.base : variantPickerChord}
          currentVariant={typeof variantPickerChord==="object"
            ? variantPickerChord.current
            : (chordVariants?.[variantPickerChord]||"standard")}
          onSelect={v=>{
            if(typeof variantPickerChord==="object"){
              // Per-slot: replace that slot with the chosen variant key
              setCustomChords(prev=>prev.map((c,k)=>k===variantPickerChord.idx ? v : c));
            } else {
              updateVariant(variantPickerChord,v);
            }
            setVariantPickerChord(null);
          }}
          onClose={()=>setVariantPickerChord(null)}
        />
      )}
    </div>
  );
}

function ChordGrid({ chords, chordIndex, nextChordIndex, isPlaying, accentColor, isLastBeat, bpm, beatsPerChord, countdown=0, chordVariants, updateVariant, perSlot=false, setCustomChords, chordIndexVal }) {
  const [variantPickerSlot, setVariantPickerSlot] = useState(null); // {idx, base, current}

  // In perSlot mode each chords[i] is self-contained; resolve via slot helpers.
  const imgFor = (slot) => perSlot ? slotImg(slot) : getChordImg(slot, chordVariants);
  const labelFor = (slot) => perSlot ? slotLabel(slot) : slot;
  const baseFor = (slot) => perSlot ? slotBase(slot) : slot;

  // ── Sliding strip animation ──
  // Decoupled from audio: this only READS timing to position the strip. The
  // metronome runs on its own timer, so the slide can never affect tempo.
  // Curve: dwell (chord held in focus) → accelerate → settle on the next chord.
  const DWELL = 0.60, SHARP = 1.8, DRIFT = 0.10;
  const VIEW_H = 250, CARD_W = 150, CARD_MARGIN = 10, STEP = CARD_W + CARD_MARGIN * 2;

  const viewportRef = useRef(null);
  const stripRef = useRef(null);
  const cardElRefs = useRef([]);
  const rafRef = useRef(null);
  const chordStartRef = useRef(performance.now());
  const lastIdxRef = useRef(chordIndex);
  const wasPlayingRef = useRef(isPlaying);

  // Stamp the moment the active chord changes (animation interpolates from here).
  useEffect(() => {
    if (chordIndex !== lastIdxRef.current) {
      lastIdxRef.current = chordIndex;
      chordStartRef.current = performance.now();
    }
  }, [chordIndex]);

  // When playback starts, calibrate the timer to "now" so the first chord
  // begins its dwell→travel from zero (no startup jump). When it stops, recenter.
  useEffect(() => {
    if (isPlaying && !wasPlayingRef.current) {
      chordStartRef.current = performance.now();
      lastIdxRef.current = chordIndex;
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying]); // eslint-disable-line

  const n = chords.length;
  // Render window: [prev, current, next, after]. The "next" slot uses the REAL
  // nextChordIndex (which honors random mode), so the chord that slides into
  // focus matches the one that actually becomes current. "after" is a best-guess
  // peek (sequential from next) — in random mode the true after isn't known yet,
  // but it only ever peeks at the edge and slides off, so it's purely cosmetic.
  const nextIdx = (typeof nextChordIndex === "number" ? nextChordIndex : (chordIndex+1)%n);
  const windowIdx = n > 0
    ? [ (chordIndex-1+n)%n, chordIndex%n, nextIdx%n, (nextIdx+1)%n ]
    : [];
  // Strip is laid out as [prev, cur, next, after]; index 1 is "current".
  const CUR_SLOT = 1;

  const vw = () => (viewportRef.current ? viewportRef.current.clientWidth : 0);
  const centerForSlot = (slot) => vw() / 2 - (slot * STEP + STEP / 2);

  const curve = (p) => {
    if (p <= DWELL) return DRIFT * (p / DWELL);
    const t = (p - DWELL) / (1 - DWELL);
    const eased = Math.pow(t, SHARP) / (Math.pow(t, SHARP) + Math.pow(1 - t, SHARP));
    return DRIFT + (1 - DRIFT) * eased;
  };

  const paint = (pos) => {
    const strip = stripRef.current; if (!strip) return;
    strip.style.transform = `translateX(${pos}px)`;
    const center = vw() / 2;
    cardElRefs.current.forEach((el) => {
      if (!el) return;
      const cardCenter = Number(el.dataset.slot) * STEP + STEP / 2 + pos;
      const dist = Math.abs(cardCenter - center);
      const t = Math.min(1, dist / STEP);
      el.style.transform = `scale(${(1 - 0.16 * t).toFixed(3)})`;
      el.style.opacity = (1 - 0.5 * t).toFixed(3);
      el.style.border = t < 0.4 ? `2px solid ${accentColor}` : "1px solid #222";
      el.style.boxShadow = t < 0.4 ? `0 0 22px rgba(${hexToRgb(accentColor)},0.26)` : "none";
    });
  };

  // Static (paused) position: current chord centered.
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      paint(centerForSlot(CUR_SLOT));
    }
  }); // eslint-disable-line

  // Playing: animate via rAF using elapsed time vs chord duration.
  useEffect(() => {
    if (!isPlaying || n === 0) return;
    const tick = (now) => {
      const beatMs = 60000 / (bpm || 60);
      const cycleMs = beatMs * (beatsPerChord || 1);
      let p = (now - chordStartRef.current) / cycleMs;
      if (p < 0) p = 0;
      if (p > 1) p = 1;
      const travel = curve(p);
      const from = centerForSlot(CUR_SLOT);
      const to = centerForSlot(CUR_SLOT + 1);
      paint(from + (to - from) * travel);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, bpm, beatsPerChord, chordIndex, n]); // eslint-disable-line

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const activeChord = n > 0 ? chords[chordIndex % n] : null;
  const activeBase = activeChord != null ? baseFor(activeChord) : null;
  const activeHasVar = activeBase != null && HAS_VARIATIONS.has(activeBase);
  const activeChosenLabel = activeChord == null ? "standard" : (perSlot
    ? (slotBase(activeChord)!==activeChord ? slotLabel(activeChord) : "standard")
    : ((chordVariants?.[activeChord]&&chordVariants[activeChord]!==activeChord)
        ? (CHORD_VARIATION_MAP[activeChord]?.find(v=>v.key===chordVariants[activeChord])?.label||chordVariants[activeChord])
        : "standard"));

  return (
    <div style={{ width:"100%", marginBottom:10 }}>

      {/* Position dots */}
      <div style={{ display:"flex", justifyContent:"center", gap:5, marginBottom:10 }}>
        {chords.map((_, i) => (
          <div key={i} style={{
            width: i===chordIndex%n ? 18 : 6, height:6, borderRadius:3,
            background: i===chordIndex%n ? accentColor : "#2a1f00",
            transition:"all 0.25s ease",
          }} />
        ))}
      </div>

      {/* Sliding strip */}
      <div ref={viewportRef} style={{ position:"relative", width:"100%", height:VIEW_H, overflow:"hidden", marginBottom:6 }}>
        <div style={{ position:"absolute", top:0, bottom:0, left:0, width:50, zIndex:5, pointerEvents:"none",
          background:"linear-gradient(90deg, #0d0d0a, rgba(13,13,10,0))" }} />
        <div style={{ position:"absolute", top:0, bottom:0, right:0, width:50, zIndex:5, pointerEvents:"none",
          background:"linear-gradient(270deg, #0d0d0a, rgba(13,13,10,0))" }} />
        <div ref={stripRef} style={{ position:"absolute", top:0, left:0, height:"100%",
          display:"flex", alignItems:"center", willChange:"transform" }}>
          {windowIdx.map((ci, slot) => {
            const chord = chords[ci];
            const isActiveSlot = slot === CUR_SLOT;
            return (
              <div key={`${ci}-${slot}`} data-slot={slot}
                ref={el=>cardElRefs.current[slot]=el}
                style={{ flex:"0 0 auto", width:CARD_W, height:210, margin:`0 ${CARD_MARGIN}px`,
                  borderRadius:14, overflow:"hidden", background:"#000", border:"1px solid #222",
                  display:"flex", willChange:"transform, opacity", position:"relative" }}>
                {imgFor(chord)
                  ? <img src={imgFor(chord)} alt={labelFor(chord)} draggable={false}
                      style={{ width:"100%", height:"100%", objectFit:"cover", display:"block", pointerEvents:"none" }} />
                  : <div style={{ margin:"auto", fontSize:36, fontWeight:900, color:accentColor }}>{labelFor(chord)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active chord label */}
      <div style={{ textAlign:"center", fontSize:16, fontWeight:900, color:accentColor, marginBottom:4 }}>
        {activeChord != null ? labelFor(activeChord) : ""}
      </div>

      {variantPickerSlot && (
        <VariantPickerModal
          chord={variantPickerSlot.base}
          currentVariant={variantPickerSlot.current||"standard"}
          onSelect={v=>{
            if(perSlot && variantPickerSlot.idx>=0){
              setCustomChords(prev=>prev.map((c,k)=>k===variantPickerSlot.idx ? v : c));
            } else {
              updateVariant(variantPickerSlot.base, v);
            }
            setVariantPickerSlot(null);
          }}
          onClose={()=>setVariantPickerSlot(null)}
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

function BuildStrumPanel({ buildActive, setBuildActive, rowSizes, setRowSizes,
  bpm, setBpm,
  currentBeat, isPlaying, stopMetronome, setIsPlaying,
  savedStrums, setSavedStrums, showSavedStrums, setShowSavedStrums,
  strumSavePrompt, setStrumSavePrompt, strumSaveName, setStrumSaveName,
  builderOpen, setBuilderOpen, sharedViewName }) {

  const cycleSize = cycleRowSize;
  const sizeLabel = rowSizeLabel;

  // Migrate legacy 2-row patterns on load to the rowSizes model
  const sizesFromPattern = (p) => {
    if(Array.isArray(p.rowSizes) && p.rowSizes.length>=1) return p.rowSizes.slice(0,8).map(n=>Number(n)||8);
    if(p.hasSecondRow) return [Number(p.row1Size)||8, Number(p.row2Size)||8];
    return [Number(p.row1Size)||8];
  };
  // Ensure a buildActive array has 64 slots
  const padBA = (arr) => {
    const out = Array.isArray(arr) ? [...arr] : [];
    while(out.length < 64) out.push(false);
    return out.slice(0,64);
  };

  const doSave = () => {
    if(!strumSaveName.trim()) return;
    const pattern = { id:Date.now(), name:strumSaveName.trim(),
      buildActive: padBA(buildActive), rowSizes, bpm,
      savedAt:new Date().toLocaleDateString() };
    const updated = [...savedStrums, pattern];
    setSavedStrums(updated);
    localStorage.setItem(STORAGE_KEYS.strumTab, JSON.stringify(updated));
    setStrumSavePrompt(false); setStrumSaveName(""); setShowSavedStrums(true);
  };

  const doLoad = (p) => {
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    setBuildActive(padBA(p.buildActive));
    setRowSizes(sizesFromPattern(p));
    if(p.bpm) setBpm(p.bpm);
    setShowSavedStrums(false);
  };

  const doShare = (p) => {
    try {
      const sizes = sizesFromPattern(p);
      const encoded = encodeStrumDrill(p.name, padBA(p.buildActive), sizes, [], p.bpm||bpm, 2, {});
      const url = `${window.location.origin}${window.location.pathname}?strum=${encoded}`;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(url)
          .then(()=>alert(`✅ Link copied!\n\nShare "${p.name}" with your members.`))
          .catch(()=>prompt("Copy this link:", url));
      } else { prompt("Copy this link:", url); }
    } catch(e) { alert("Couldn't generate link."); }
  };

  const isSharedView = !builderOpen;

  if(isSharedView) return (
    <div style={{ width:"100%", marginBottom:20 }}>
      {sharedViewName && (
        <div style={{ textAlign:"center", marginBottom:14 }}>
          <div style={{ fontSize:20, fontWeight:900, color:"#fff", letterSpacing:0.3,
            textShadow:"0 2px 8px rgba(0,0,0,0.5)" }}>{sharedViewName}</div>
        </div>
      )}

      {/* Read-only pattern display */}
      <div style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a",
        borderRadius:20, padding:"14px 10px", marginBottom:12 }}>
        <div style={{ fontSize:9, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:12 }}>STRUMMING PATTERN</div>
        {rowSizes.map((rs, rIdx) => {
          // Sequential beat offset for this row = sum of all prior row sizes
          let beatOffset = 0;
          for(let k=0;k<rIdx;k++) beatOffset += rowSizes[k];
          return (
            <div key={rIdx} style={{ display:"flex", gap:4, justifyContent:"center", flexWrap:"nowrap",
              marginTop: rIdx>0 ? 8 : 0 }}>
              {Array(rs).fill(null).map((_,i)=>{
                const slotIdx = rIdx*8 + i;
                const sequentialBeat = beatOffset + i;
                // currentBeat is the array slot index (from tick mapping)
                return (
                  <div key={i} style={{ flex:"1 1 0", minWidth:0, maxWidth:40, aspectRatio:"1/1", display:"flex" }}>
                    <BuildBlock dir={DIRS16[i%8]} active={buildActive[slotIdx]}
                      beat={currentBeat===slotIdx && isPlaying} onClick={()=>{}} fluid />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Save / Load */}
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <button onClick={()=>setStrumSavePrompt(p=>!p)} style={{
          flex:1, padding:"10px", borderRadius:12,
          border:"1px solid #FFBE0B44", background:"rgba(255,190,11,0.07)",
          color:"#FFBE0B", fontSize:13, fontWeight:700, cursor:"pointer" }}>💾 Save</button>
        <button onClick={()=>setShowSavedStrums(s=>!s)} style={{
          flex:1, padding:"10px", borderRadius:12,
          border:"1px solid #2a2a2a", background:"#111",
          color:"#888", fontSize:13, fontWeight:700, cursor:"pointer" }}>
          📂 My Patterns ({savedStrums.length})
        </button>
      </div>

      {strumSavePrompt && (
        <SavePrompt header="Name this pattern" placeholder="e.g. D DU UDU..."
          value={strumSaveName} onChange={setStrumSaveName}
          onSave={doSave} onCancel={()=>setStrumSavePrompt(false)} />
      )}

      {showSavedStrums && (
        <div style={{ marginBottom:10, display:"flex", flexDirection:"column", gap:6 }}>
          {savedStrums.length===0 && <div style={{ textAlign:"center", color:"#444", fontSize:13, padding:"14px 0" }}>No saved patterns yet</div>}
          {savedStrums.map(p=>(
            <div key={p.id} style={{ background:"#111", border:"1px solid #2a2a2a", borderRadius:12, padding:"10px 14px",
              display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#fff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</div>
                <div style={{ fontSize:11, color:"#555", marginTop:2 }}>{(sizesFromPattern(p).length)} row{sizesFromPattern(p).length!==1?"s":""} · {p.savedAt}</div>
              </div>
              <div style={{ display:"flex", gap:6, marginLeft:10 }}>
                <button onClick={()=>doLoad(p)} style={{ padding:"6px 12px", borderRadius:8, border:"none",
                  background:"linear-gradient(135deg,#FFBE0B,#F77F00)", color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                <button onClick={()=>doShare(p)} style={{ padding:"6px 10px", borderRadius:8,
                  border:"1px solid #333", background:"transparent", color:"#6b9fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>🔗</button>
                <button onClick={()=>{ const u=savedStrums.filter(x=>x.id!==p.id); setSavedStrums(u); localStorage.setItem(STORAGE_KEYS.strumTab,JSON.stringify(u)); }}
                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #333", background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={()=>setBuilderOpen(true)} style={{
        width:"100%", padding:"8px", marginTop:4, borderRadius:10,
        border:"1px solid #2a2a2a", background:"transparent",
        color:"#555", fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:1,
      }}>▼ SHOW BUILDER</button>
    </div>
  );

  return (
    <div style={{ width:"100%", background:"#0c0a06",
      border:"1px solid #241d10", borderRadius:20, padding:"18px 16px", marginBottom:20,
      boxShadow:"0 6px 24px rgba(0,0,0,0.5)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
        <div style={{ width:60 }} />
        <div style={{ fontSize:11, color:"#8a7f5e", letterSpacing:2, fontWeight:700 }}>BUILD YOUR PATTERN</div>
        <button onClick={()=>setBuilderOpen(false)} style={{ background:"none", border:"none",
          color:"#6f6749", fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:0.5,
          fontFamily:"inherit" }}>Hide ▲</button>
      </div>
      <p style={{ textAlign:"center", fontSize:12, color:"#776b4d", marginBottom:16 }}>Tap blocks to toggle active ↔ ghost</p>

      {/* Rows */}
      {rowSizes.map((rs, rIdx) => (
        <div key={rIdx} style={{ marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:5 }}>
            <div style={{ fontSize:10, color:"#5a5238", letterSpacing:1 }}>ROW {rIdx+1}</div>
            <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
              const ns = cycleSize(rs);
              setRowSizes(p=>p.map((v,k)=>k===rIdx?ns:v));
              setBuildActive(p=>{ const n=[...p]; for(let i=ns;i<8;i++) n[rIdx*8+i]=false; return n; });
            }} style={{ padding:"4px 12px", borderRadius:8, border:"1px solid #241d10",
              background:"#16110a", color:"#FFD60A", fontSize:12, fontWeight:700, cursor:"pointer",
              fontFamily:"inherit" }}>
              {sizeLabel(rs)} ↻
            </button>
          </div>
          <div style={{ display:"flex", gap:4, justifyContent:"center", flexWrap:"nowrap" }}>
            {Array(rs).fill(null).map((_,i)=>{
              const slotIdx = rIdx*8 + i;
              return (
                <div key={i} style={{ flex:"1 1 0", minWidth:0, maxWidth:40, aspectRatio:"1/1", display:"flex" }}>
                  <BuildBlock dir={DIRS16[i%8]} active={buildActive[slotIdx]}
                    beat={currentBeat===slotIdx&&isPlaying} fluid
                    onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                      setBuildActive(p=>p.map((v,idx)=>idx===slotIdx?!v:v)); }} />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Row controls */}
      <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:12, marginBottom:16, flexWrap:"wrap" }}>
        {rowSizes.length<8 && (
          <button onClick={()=>{
            if(isPlaying){stopMetronome();setIsPlaying(false);}
            const newRowIdx = rowSizes.length;
            setRowSizes(p=>[...p, 8]);
            setBuildActive(p=>{ const n=[...p]; for(let i=0;i<8;i++) n[newRowIdx*8+i] = defaultBuild(8)[i]; return n; });
          }} style={{
            padding:"9px 18px", borderRadius:11, border:"1px solid rgba(255,190,11,0.5)",
            background:"radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.12) 0%, rgba(255,170,30,0) 60%), #16110a",
            color:"#FFD60A", fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"inherit",
            boxShadow:"0 0 14px rgba(255,160,20,0.18)" }}>+ Add Row</button>
        )}
        {rowSizes.length>1 && (
          <button onClick={()=>{
            if(isPlaying){stopMetronome();setIsPlaying(false);}
            const rmIdx = rowSizes.length-1;
            setRowSizes(p=>p.slice(0,-1));
            setBuildActive(p=>{ const n=[...p]; for(let i=0;i<8;i++) n[rmIdx*8+i]=false; return n; });
          }} style={{
            padding:"9px 18px", borderRadius:11, border:"1px solid #241d10",
            background:"#100d09", color:"#8a7f5e", fontSize:12, fontWeight:700, cursor:"pointer",
            fontFamily:"inherit" }}>− Remove Row</button>
        )}
        <button onClick={()=>{
          if(isPlaying){stopMetronome();setIsPlaying(false);}
          setRowSizes([8]);
          const arr=[]; for(let r=0;r<8;r++) arr.push(...(r===0?defaultBuild(8):Array(8).fill(false)));
          setBuildActive(arr);
        }} style={{
          padding:"9px 14px", borderRadius:11, border:"1px solid #241d10",
          background:"#100d09", color:"#6f6749", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Reset</button>
        <button onClick={()=>setStrumSavePrompt(p=>!p)} style={{
          padding:"9px 14px", borderRadius:11, border:"1px solid rgba(255,190,11,0.4)",
          background:"rgba(255,190,11,0.08)", color:"#FFD60A", fontSize:12, fontWeight:800, cursor:"pointer",
          fontFamily:"inherit" }}>💾 Save</button>
        <button onClick={()=>setShowSavedStrums(s=>!s)} style={{
          padding:"9px 14px", borderRadius:11, border:"1px solid #241d10",
          background:"#100d09", color:"#8a7f5e", fontSize:12, fontWeight:700, cursor:"pointer",
          fontFamily:"inherit" }}>
          📂 My Patterns ({savedStrums.length})
        </button>
      </div>

      {/* Save prompt */}
      {strumSavePrompt && (
        <SavePrompt header="Name this pattern" placeholder="e.g. D DU UDU..."
          value={strumSaveName} onChange={setStrumSaveName}
          onSave={doSave} onCancel={()=>{setStrumSavePrompt(false);setStrumSaveName("");}}
          wrapStyle={{ marginBottom:14 }} />
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
                  {p.bpm ? `${p.bpm} BPM · ` : ""}{sizesFromPattern(p).length} row{sizesFromPattern(p).length!==1?"s":""} · {p.savedAt}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, marginLeft:10 }}>
                <button onClick={()=>doLoad(p)} style={{ padding:"6px 12px", borderRadius:8, border:"none",
                  background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
                  color:"#111", fontSize:12, fontWeight:800, cursor:"pointer" }}>Load</button>
                <button onClick={()=>doShare(p)} style={{ padding:"6px 10px", borderRadius:8,
                  border:"1px solid #333", background:"transparent",
                  color:"#6b9fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>🔗 Share</button>
                <button onClick={()=>{
                  const updated=savedStrums.filter(x=>x.id!==p.id);
                  setSavedStrums(updated);
                  localStorage.setItem(STORAGE_KEYS.strumTab, JSON.stringify(updated));
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
  onToggle, canPlay, disabledLabel, onScrubStart, onScrubEnd, countdown=0 }) {
  return (
    <div style={{ background:"#0c0a06", border:"1px solid #241d10",
      borderRadius:20, padding:"22px 24px", width:"100%", boxShadow:"0 6px 22px rgba(0,0,0,0.5)" }}>
      {/* Thick, easy-to-grab slider (range inputs need explicit thumb/track styling) */}
      <style>{`
        .ntc-bpm-slider { -webkit-appearance:none; appearance:none; width:100%; height:30px;
          background:transparent; cursor:pointer; outline:none; }
        .ntc-bpm-slider::-webkit-slider-runnable-track { height:10px; border-radius:99px;
          background:#241d10; }
        .ntc-bpm-slider::-moz-range-track { height:10px; border-radius:99px; background:#241d10; }
        .ntc-bpm-slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none;
          width:30px; height:30px; margin-top:-10px; border-radius:50%;
          background:radial-gradient(circle at 35% 30%, #FFE27A, #FFBE0B 55%, #F77F00);
          border:2px solid #1a1208; box-shadow:0 0 12px rgba(255,170,20,0.5); cursor:pointer; }
        .ntc-bpm-slider::-moz-range-thumb { width:28px; height:28px; border-radius:50%;
          background:radial-gradient(circle at 35% 30%, #FFE27A, #FFBE0B 55%, #F77F00);
          border:2px solid #1a1208; box-shadow:0 0 12px rgba(255,170,20,0.5); cursor:pointer; }
      `}</style>
      <div style={{ textAlign:"center", marginBottom:14 }}>
        <span style={{ fontSize:16, fontWeight:800 }}>Metronome </span>
        <span style={{ fontSize:16, fontWeight:800, color:"#FFBE0B" }}>({bpm} BPM)</span>
      </div>
      <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:16 }}>
        {Array(Math.max(4, totalBlocks/2)).fill(null).slice(0,4).map((_,i)=>{
          const b=i*2, lit=(currentBeat===b||currentBeat===b+1)&&isPlaying;
          return <div key={i} style={{ width:11, height:11, borderRadius:"50%",
            background:lit?"#FFBE0B":"#2a1f0a",
            boxShadow:lit?"0 0 8px #FFBE0B":"none",
            transition:"background 0.05s" }} />;
        })}
      </div>
      <input type="range" min={20} max={160} value={bpm} className="ntc-bpm-slider"
        onChange={e=>setBpm(Number(e.target.value))}
        onMouseDown={()=>onScrubStart&&onScrubStart()}
        onMouseUp={()=>onScrubEnd&&onScrubEnd()}
        onTouchStart={()=>onScrubStart&&onScrubStart()}
        onTouchEnd={()=>onScrubEnd&&onScrubEnd()}
        style={{ marginBottom:6 }} />
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#5a5238", marginBottom:16 }}>
        <span>40</span><span>160</span>
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:16 }}>
        {[40,60,80,100].map(b=>(
          <button key={b} onClick={()=>setBpm(b)} style={{
            flex:1, maxWidth:90, padding:"12px 0", borderRadius:12,
            border:`1px solid ${bpm===b ? "rgba(255,190,11,0.5)" : "#241d10"}`,
            background:bpm===b?"rgba(255,190,11,0.1)":"#100d09",
            color:bpm===b?"#FFD60A":"#8a7f5e", fontSize:15, fontWeight:800, cursor:"pointer",
            fontFamily:"inherit", transition:"all 0.2s" }}>{b}</button>
        ))}
      </div>
      <button onClick={onToggle} disabled={!canPlay} style={{
        width:"100%", padding:"14px", borderRadius:14,
        border: !canPlay ? "1px solid #1c1710"
          : (isPlaying||countdown>0) ? "1px solid rgba(231,76,60,0.5)"
          : "1px solid rgba(255,190,11,0.5)",
        background: !canPlay ? "#100d09"
          : (isPlaying||countdown>0) ? "radial-gradient(120% 160% at 50% 0%, rgba(231,76,60,0.18) 0%, rgba(231,76,60,0) 70%), #1a0f0c"
          : "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.2) 0%, rgba(255,170,30,0) 70%), #16110a",
        color:!canPlay?"#3a3528": (isPlaying||countdown>0) ? "#ff8a7a" : "#FFD60A", fontSize:16, fontWeight:900,
        letterSpacing:0.5, cursor:canPlay?"pointer":"not-allowed",
        boxShadow: !canPlay?"none"
          : (isPlaying||countdown>0) ? "0 0 22px rgba(231,76,60,0.2)"
          : "0 0 22px rgba(255,160,20,0.22)",
        fontFamily:"inherit", transition:"all 0.2s" }}>
        {!canPlay ? (disabledLabel||"Select options to start")
          : countdown>0
            ? <><span style={{ fontSize:22, fontWeight:900 }}>{countdown}</span>
                <span style={{ fontSize:11, fontWeight:700, opacity:0.7, marginLeft:8 }}>tap to skip</span></>
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

function BuildBlock({ dir, active, beat, onClick, assigned, fluid }) {
  return (
    <div onClick={onClick} style={{
      width: fluid ? "100%" : 40,
      height: fluid ? "100%" : 40,
      borderRadius:10,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize: fluid ? "min(20px, 4.5vw)" : 20, cursor:"pointer",
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
  return (
    <button onClick={onClick} style={{
      padding:"10px 16px", borderRadius:11,
      border:`1px solid ${active ? "rgba(255,190,11,0.5)" : "#241d10"}`,
      background: active
        ? "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.12) 0%, rgba(255,170,30,0) 60%), #16110a"
        : "#100d09",
      color: active ? "#FFD60A" : "#8a7f5e", fontSize:12, fontWeight:800, cursor:"pointer",
      boxShadow: active ? "0 0 14px rgba(255,160,20,0.18)" : "none",
      fontFamily:"inherit", transition:"all 0.2s" }}>
      {label}
    </button>
  );
}

// ─── SHARED SAVE PROMPT ──────────────────────────────────────────────────────
// Name-this input + Save + ✕ row. Everything that differs between call sites is
// a prop; the markup is identical to the original inline blocks.
function SavePrompt({ header, placeholder, value, onChange, onSave, onCancel, wrapStyle, footer }) {
  return (
    <div style={{ marginBottom:10, background:"#111", border:"1px solid #FFBE0B33",
      borderRadius:14, padding:"14px", ...(wrapStyle||{}) }}>
      <div style={{ fontSize:12, color:"#888", marginBottom:8, textAlign:"center" }}>{header}</div>
      <div style={{ display:"flex", gap:8 }}>
        <input autoFocus value={value} onChange={e=>onChange(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") onSave(); }}
          placeholder={placeholder}
          style={{ flex:1, padding:"9px 12px", borderRadius:10, border:"1px solid #333",
            background:"#0a0a0a", color:"#fff", fontSize:13, outline:"none" }} />
        <button onClick={onSave} style={{ padding:"9px 16px", borderRadius:10, border:"none",
          background:"linear-gradient(135deg,#FFBE0B,#F77F00)",
          color:"#111", fontSize:13, fontWeight:800, cursor:"pointer" }}>Save</button>
        <button onClick={onCancel} style={{ padding:"9px 12px", borderRadius:10, border:"1px solid #333",
          background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>✕</button>
      </div>
      {footer}
    </div>
  );
}

// ─── 30-DAY TRACKER ──────────────────────────────────────────────────────────
const TRACKER_DAYS = 30;
const TRACKER_TASKS = [
  { id: "chords",    label: "Chord Switching", icon: "🎸" },
  { id: "strumming", label: "Strumming",       icon: "🥁" },
  { id: "song",      label: "Song Practice",   icon: "🎵" },
];
const TRACKER_STORAGE_KEY = "ntc-30day-tracker-v1";

// Same bit-packing encode/decode as the original standalone tracker — kept
// identical so any existing ?d= tracker share links still decode correctly.
function trackerEncode(data) {
  const bits = [];
  data.forEach(day => TRACKER_TASKS.forEach(t => bits.push(day[t.id] ? 1 : 0)));
  while (bits.length % 8 !== 0) bits.push(0);
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] || 0);
    bytes.push(byte);
  }
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function trackerDecode(str) {
  try {
    const binary = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const bits = [];
    for (let i = 0; i < binary.length; i++) {
      const byte = binary.charCodeAt(i);
      for (let j = 7; j >= 0; j--) bits.push((byte >> j) & 1);
    }
    const data = Array.from({ length: TRACKER_DAYS }, () =>
      Object.fromEntries(TRACKER_TASKS.map(t => [t.id, false]))
    );
    let idx = 0;
    data.forEach(day => TRACKER_TASKS.forEach(t => { day[t.id] = bits[idx++] === 1; }));
    return data;
  } catch (_) { return null; }
}
function trackerInit() {
  return Array.from({ length: TRACKER_DAYS }, () =>
    Object.fromEntries(TRACKER_TASKS.map(t => [t.id, false]))
  );
}
function trackerStreak(data) {
  let lastActive = -1;
  for (let i = TRACKER_DAYS - 1; i >= 0; i--) {
    if (TRACKER_TASKS.some(t => data[i][t.id])) { lastActive = i; break; }
  }
  if (lastActive === -1) return 0;
  let streak = 0;
  for (let i = lastActive; i >= 0; i--) {
    if (TRACKER_TASKS.some(t => data[i][t.id])) streak++;
    else break;
  }
  return streak;
}

function useTrackerConfetti() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  function launch() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    const colors = ["#FFD60A", "#F77F00", "#ffffff", "#FFBE0B", "#FFE27A"];
    const pieces = Array.from({ length: 160 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 100,
      w: 8 + Math.random() * 8,
      h: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      opacity: 1,
    }));
    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rotation += p.rotSpeed;
        if (frame > 120) p.opacity = Math.max(0, p.opacity - 0.012);
        ctx.save(); ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame++;
      if (frame < 220) animRef.current = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (animRef.current) cancelAnimationFrame(animRef.current);
    draw();
  }
  return { canvasRef, launch };
}

function TrackerTab() {
  const [data, setData] = useState(trackerInit);
  const [loaded, setLoaded] = useState(false);
  const [celebrating, setCelebrating] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const { canvasRef, launch } = useTrackerConfetti();

  // Load — reads ?d= (tracker share) then localStorage. Does NOT clear other
  // URL params; the main app handles its own exercise params separately.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const d = params.get("d");
      if (d) {
        const decoded = trackerDecode(d);
        if (decoded) { setData(decoded); setLoaded(true); return; }
      }
      const saved = localStorage.getItem(TRACKER_STORAGE_KEY);
      if (saved) setData(JSON.parse(saved));
    } catch (_) {}
    setLoaded(true);
  }, []);

  // Auto-save
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }, [data, loaded]);

  // 30-day completion celebration
  useEffect(() => {
    if (!loaded) return;
    const allDaysActive = data.every(day => TRACKER_TASKS.some(t => day[t.id]));
    if (allDaysActive) { setShowModal(true); launch(); }
  }, [data, loaded]); // eslint-disable-line

  function toggle(dayIdx, taskId) {
    setData(prev => {
      const next = prev.map((day, i) => i === dayIdx ? { ...day, [taskId]: !day[taskId] } : day);
      const dayDone = TRACKER_TASKS.filter(t => next[dayIdx][t.id]).length;
      if (dayDone === TRACKER_TASKS.length) setCelebrating(dayIdx);
      return next;
    });
    setTimeout(() => setCelebrating(null), 1200);
  }

  function resetAll() {
    if (window.confirm("Reset all 30 days? This can't be undone.")) {
      setData(trackerInit());
      // Surgical: only strip the tracker's own ?d= param, preserve everything else.
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.has("d")) {
          params.delete("d");
          const qs = params.toString();
          window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
        }
      } catch (_) {}
    }
  }

  const streak = trackerStreak(data);
  const totalDaysActive = data.filter(d => TRACKER_TASKS.some(t => d[t.id])).length;
  const totalChecks = data.reduce((acc, d) => acc + TRACKER_TASKS.filter(t => d[t.id]).length, 0);
  const maxChecks = TRACKER_DAYS * TRACKER_TASKS.length;
  const overallPct = Math.round((totalChecks / maxChecks) * 100);

  const statBox = {
    position:"relative", border:"1px solid #241d10", borderRadius:16, padding:"16px 12px",
    textAlign:"center",
    background:"radial-gradient(130% 130% at 50% 0%, rgba(255,170,30,0.06) 0%, rgba(255,170,30,0) 60%), #100d09",
    boxShadow:"0 6px 18px rgba(0,0,0,0.4)",
  };
  const statV = { fontSize:30, fontWeight:900, color:"#FFBE0B", lineHeight:1, letterSpacing:0.5, textShadow:"0 0 18px rgba(255,170,20,0.25)" };
  const statL = { fontSize:9.5, color:"#6f6749", textTransform:"uppercase", letterSpacing:1, fontWeight:700, marginTop:6 };

  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"18px 16px 60px" }}>
      <canvas ref={canvasRef} style={{ position:"fixed", top:0, left:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:9999 }} />

      {/* Completion modal */}
      {showModal && (
        <div onClick={()=>setShowModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)",
          zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#111", border:"1px solid #2a2a2a",
            borderRadius:24, padding:"40px 28px", maxWidth:420, width:"100%", textAlign:"center", position:"relative" }}>
            <div style={{ position:"absolute", top:0, left:0, right:0, height:3,
              background:"linear-gradient(90deg,#FFD60A,#F77F00)", borderRadius:"24px 24px 0 0" }} />
            <span style={{ fontSize:64, marginBottom:16, display:"block" }}>🎸</span>
            <div style={{ fontSize:30, fontWeight:900, marginBottom:8, letterSpacing:0.5,
              background:"linear-gradient(135deg,#FFD60A,#F77F00)", WebkitBackgroundClip:"text",
              backgroundClip:"text", WebkitTextFillColor:"transparent", lineHeight:1.1 }}>
              YOU'RE AN OFFICIAL GUITAR PLAYER
            </div>
            <div style={{ fontSize:16, color:"#fff", fontWeight:700, marginBottom:16 }}>30 Days. Done. No excuses.</div>
            <p style={{ fontSize:14, color:"#999", lineHeight:1.7, marginBottom:24 }}>
              You showed up <strong style={{color:"#ccc"}}>every single day</strong> for 30 days straight.
              That's not a beginner anymore — that's a guitar player. Keep going. 🔥
            </p>
            <button onClick={()=>setShowModal(false)} style={{ background:"linear-gradient(135deg,#FFD60A,#F77F00)",
              border:"none", borderRadius:12, padding:"14px 32px", fontSize:15, fontWeight:900, color:"#111",
              cursor:"pointer", width:"100%" }}>
              Let's keep going! 🤩
            </button>
          </div>
        </div>
      )}

      {/* Compact intro */}
      <div style={{ textAlign:"center", marginBottom:22 }}>
        <div style={{ fontSize:11, letterSpacing:3, color:"#7a6a3a", fontWeight:700, textTransform:"uppercase" }}>
          30-Day Challenge
        </div>
        <div style={{ fontSize:24, fontWeight:900, marginTop:8, color:"#f3ead2", letterSpacing:0.3 }}>
          Build the habit. <span style={{ background:"linear-gradient(135deg,#FFD60A,#F77F00)",
            WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent" }}>Keep the streak 🔥</span>
        </div>
        <div style={{ fontSize:12.5, color:"#776b4d", marginTop:8, lineHeight:1.6 }}>
          Practice daily — even 5 minutes counts. Momentum beats perfection.
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:11, marginBottom:22 }}>
        <div style={statBox}><div style={statV}>{streak}</div><div style={statL}>Current Streak</div></div>
        <div style={statBox}><div style={statV}>{totalDaysActive}</div><div style={statL}>Days Active</div></div>
        <div style={statBox}><div style={statV}>{overallPct}%</div><div style={statL}>Completion</div></div>
      </div>

      {/* Progress */}
      <div style={{ marginBottom:26 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <span style={{ fontSize:10, color:"#6f6749", textTransform:"uppercase", letterSpacing:1.5, fontWeight:700 }}>Overall Progress</span>
          <span style={{ fontSize:12, color:"#FFBE0B", fontWeight:800 }}>{totalChecks} / {maxChecks} tasks</span>
        </div>
        <div style={{ height:7, background:"#1a160d", borderRadius:99, overflow:"hidden", border:"1px solid #241d10" }}>
          <div style={{ height:"100%", width:`${overallPct}%`, borderRadius:99,
            background:"linear-gradient(90deg,#FFD60A,#F77F00)", boxShadow:"0 0 12px rgba(255,170,20,0.5)",
            transition:"width 0.5s ease" }} />
        </div>
      </div>

      {/* Day grid */}
      <div style={{ border:"1px solid #241d10", borderRadius:18, overflow:"hidden", background:"#0c0a06" }}>
        <div style={{ display:"grid", gridTemplateColumns:"78px 1fr 1fr 1fr 56px", background:"#100d09",
          borderBottom:"1px solid #1c1710", padding:"12px 14px", gap:8, alignItems:"center" }}>
          <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:1, color:"#5a5238", fontWeight:700 }}>Day</div>
          {TRACKER_TASKS.map(t => (
            <div key={t.id} style={{ fontSize:9, textTransform:"uppercase", letterSpacing:1, color:"#5a5238",
              fontWeight:700, display:"flex", flexDirection:"column", alignItems:"center", gap:3, textAlign:"center", lineHeight:1.3 }}>
              <span style={{ fontSize:13 }}>{t.icon}</span>{t.label}
            </div>
          ))}
          <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:1, color:"#5a5238", fontWeight:700, textAlign:"right" }}>%</div>
        </div>

        {data.map((day, i) => {
          const done = TRACKER_TASKS.filter(t => day[t.id]).length;
          const pct = Math.round((done / TRACKER_TASKS.length) * 100);
          const isComplete = pct === 100;
          const isPartial = pct > 0 && pct < 100;
          const isActive = done > 0;
          const emoji = isComplete ? "⭐" : isPartial ? "🔥" : null;
          const isCelebrating = celebrating === i;
          const r = 12, cx = 16, cy = 16;
          const circ = 2 * Math.PI * r;
          const offset = circ - (pct / 100) * circ;
          const ringColor = isComplete ? "#FFD60A" : isPartial ? "#F77F00" : "#222";
          return (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"78px 1fr 1fr 1fr 56px", alignItems:"center",
              padding:"0 14px", gap:8, borderBottom:"1px solid #141008", minHeight:54,
              background: isComplete ? "linear-gradient(90deg, rgba(247,127,0,0.07), transparent)"
                : isCelebrating ? "rgba(255,214,10,0.10)" : "transparent",
              transition:"background 0.3s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:14, fontWeight:900, color:isActive?"#FFBE0B":"#3a3325", letterSpacing:0.3, minWidth:46 }}>DAY {i+1}</span>
                {emoji && <span style={{ fontSize:14 }}>{emoji}</span>}
              </div>
              {TRACKER_TASKS.map(t => (
                <div key={t.id} style={{ display:"flex", justifyContent:"center" }}>
                  <div onClick={()=>toggle(i, t.id)} role="checkbox" aria-checked={day[t.id]} tabIndex={0}
                    onKeyDown={e=>(e.key==="Enter"||e.key===" ")&&toggle(i,t.id)}
                    style={{ width:30, height:30, borderRadius:8, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      border:`2px solid ${day[t.id] ? "rgba(255,190,11,0.6)" : "#2a2417"}`,
                      background: day[t.id]
                        ? "radial-gradient(130% 130% at 50% 0%, rgba(255,190,11,0.22), rgba(255,140,0,0.12)), #16110a"
                        : "#0e0b06",
                      boxShadow: day[t.id] ? "0 0 12px rgba(255,170,20,0.35), inset 0 0 6px rgba(255,190,11,0.15)" : "none",
                      transition:"all 0.16s" }}>
                    {day[t.id] && (
                      <div style={{ width:10, height:6, borderLeft:"2px solid #FFD60A", borderBottom:"2px solid #FFD60A",
                        transform:"rotate(-45deg) translate(1px,-1px)" }} />
                    )}
                  </div>
                </div>
              ))}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
                <svg width="32" height="32" viewBox="0 0 32 32">
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1c160d" strokeWidth="3" />
                  {pct > 0 && (
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke={ringColor} strokeWidth="3"
                      strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                      transform={`rotate(-90 ${cx} ${cy})`} style={{ transition:"stroke-dashoffset 0.4s ease" }} />
                  )}
                </svg>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display:"flex", gap:14, marginTop:18, justifyContent:"center", flexWrap:"wrap" }}>
        {[["⭐","100% day"],["🔥","Partial day"],["🎸","Chords"],["🥁","Strumming"],["🎵","Song"]].map(([e,l])=>(
          <div key={l} style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"#5a5238" }}>
            <span>{e}</span><span>{l}</span>
          </div>
        ))}
      </div>

      {/* Reset */}
      <div style={{ display:"flex", justifyContent:"center", marginTop:22 }}>
        <button onClick={resetAll} style={{ background:"transparent", border:"1px solid #241d10", color:"#6f6749",
          fontSize:11, fontFamily:"inherit", padding:"8px 16px", borderRadius:10, cursor:"pointer", letterSpacing:1 }}>
          Reset all 30 days
        </button>
      </div>

      <div style={{ textAlign:"center", paddingTop:28, color:"#332e22", fontSize:11 }}>
        © {new Date().getFullYear()} No Theory Club · All rights reserved.
      </div>
    </div>
  );
}

// ─── LANDING SCREEN ──────────────────────────────────────────────────────────
// Clean title screen shown on a fresh visit (no shared exercise URL). The four
// cards navigate to each tab. Fade-in + warm-glow dark buttons.
function LandingScreen({ onPick, streak }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 20); return () => clearTimeout(t); }, []);

  const rise = (delay) => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? "translateY(0)" : "translateY(14px)",
    transition: `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s`,
  });

  const items = [
    { id:"strum",   icon:"🎸", title:"Strumming",      sub:"Patterns, rhythm & the universal motion" },
    { id:"chords",  icon:"🤚", title:"Chords",          sub:"Switching drills & chord packs" },
    { id:"tracker", icon:"🔥", title:"30-Day Tracker",  sub:"Build the habit, keep your streak", streak:true },
  ];

  const [hover, setHover] = useState(null);

  return (
    <div style={{ minHeight:"100vh",
      background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff",
      display:"flex", flexDirection:"column", alignItems:"center" }}>
      <div style={{ width:"100%", maxWidth:480, padding:"0 22px 40px",
        display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}>

        {/* Hero */}
        <div style={{ textAlign:"center", padding:"72px 0 14px", ...rise(0) }}>
          <span style={{ display:"inline-block", fontSize:11, letterSpacing:4,
            color:"#7a6a3a", fontWeight:700, marginBottom:22, textTransform:"uppercase" }}>
            🎸 Guitar Practice Tool
          </span>
          <div style={{ fontSize:44, lineHeight:0.95, fontWeight:900, letterSpacing:0.5,
            background:"linear-gradient(135deg,#FFE27A 0%, #FFBE0B 45%, #F77F00 100%)",
            WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent",
            filter:"drop-shadow(0 4px 18px rgba(255,140,0,0.22))", marginBottom:12 }}>
            NO THEORY<span style={{ display:"block" }}>CLUB</span>
          </div>
          <div style={{ fontSize:13, color:"#9a8d6a", letterSpacing:1 }}>
            Play by feel. Skip the theory.
          </div>
          <div style={{ width:50, height:3, borderRadius:3,
            background:"linear-gradient(90deg,#FFD60A,#F77F00)", margin:"20px auto 0", opacity:0.85 }} />
        </div>

        <div style={{ margin:"20px 0 20px", fontSize:13, color:"#6f6749", fontWeight:700,
          letterSpacing:2, textTransform:"uppercase", textAlign:"center", ...rise(0.12) }}>
          What do you want to work on?
        </div>

        {/* Cards */}
        <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:13 }}>
          {items.map((it, i) => {
            const isHover = hover === it.id;
            return (
              <button key={it.id}
                onClick={()=>onPick(it.id)}
                onMouseEnter={()=>setHover(it.id)}
                onMouseLeave={()=>setHover(null)}
                style={{
                  position:"relative", width:"100%",
                  border:`1px solid ${isHover ? "rgba(255,190,11,0.45)" : "#241d10"}`,
                  borderRadius:18, padding:"20px", cursor:"pointer", textAlign:"left",
                  display:"flex", alignItems:"center", gap:16, color:"#fff", fontFamily:"inherit",
                  background: isHover
                    ? "radial-gradient(120% 140% at 0% 50%, rgba(255,170,30,0.14) 0%, rgba(255,170,30,0) 60%), #14100a"
                    : "radial-gradient(120% 140% at 0% 50%, rgba(255,170,30,0.07) 0%, rgba(255,170,30,0) 55%), #100d09",
                  boxShadow: isHover
                    ? "0 10px 30px rgba(0,0,0,0.55), 0 0 26px rgba(255,160,20,0.22)"
                    : "0 6px 22px rgba(0,0,0,0.45)",
                  transform: isHover ? "translateY(-2px)" : "translateY(0)",
                  transition:"transform 0.18s ease, box-shadow 0.25s ease, border-color 0.25s ease, background 0.25s ease",
                  ...rise(0.22 + i*0.1),
                }}>
                <span style={{ fontSize:26, width:48, height:48, borderRadius:14,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  background: isHover ? "rgba(255,190,11,0.12)" : "rgba(255,190,11,0.06)",
                  border:`1px solid ${isHover ? "rgba(255,190,11,0.3)" : "rgba(255,190,11,0.12)"}`,
                  flexShrink:0, transition:"background 0.25s, border-color 0.25s" }}>
                  {it.icon}
                </span>
                <span style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <span style={{ fontSize:18, fontWeight:900, letterSpacing:0.2,
                    color: isHover ? "#FFD60A" : "#f3ead2", transition:"color 0.25s" }}>{it.title}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:"#776b4d" }}>{it.sub}</span>
                </span>
                {it.streak ? (
                  <span style={{ marginLeft:"auto", display:"flex", flexDirection:"column", alignItems:"center",
                    background: isHover ? "rgba(255,190,11,0.1)" : "rgba(255,190,11,0.06)",
                    border:`1px solid ${isHover ? "rgba(255,190,11,0.4)" : "rgba(255,190,11,0.18)"}`,
                    borderRadius:11, padding:"5px 11px", marginRight:6,
                    transition:"border-color 0.25s, background 0.25s" }}>
                    <span style={{ fontSize:18, fontWeight:900, color:"#FFBE0B", lineHeight:1 }}>{streak||0}</span>
                    <span style={{ fontSize:8, color:"#776b4d", letterSpacing:1, marginTop:2 }}>DAYS</span>
                  </span>
                ) : (
                  <span style={{ marginLeft:"auto", fontSize:22, fontWeight:900,
                    color: isHover ? "#FFBE0B" : "#3a3325",
                    transform: isHover ? "translateX(3px)" : "translateX(0)",
                    transition:"color 0.25s, transform 0.25s" }}>›</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Separated Build a Song (Beta) — dimmer, set apart */}
        <div style={{ width:"100%", marginTop:22, ...rise(0.6) }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, opacity:0.7 }}>
            <div style={{ flex:1, height:1, background:"#241d10" }} />
            <div style={{ fontSize:9, color:"#5a5238", letterSpacing:2, fontWeight:700 }}>EXPERIMENTAL</div>
            <div style={{ flex:1, height:1, background:"#241d10" }} />
          </div>
          <button
            onClick={()=>onPick("song")}
            onMouseEnter={()=>setHover("song")}
            onMouseLeave={()=>setHover(null)}
            style={{
              width:"100%", border:`1px solid ${hover==="song" ? "rgba(255,190,11,0.3)" : "#1c1710"}`,
              borderRadius:16, padding:"16px 18px", cursor:"pointer", textAlign:"left",
              display:"flex", alignItems:"center", gap:14, color:"#fff", fontFamily:"inherit",
              background: hover==="song" ? "#100d09" : "#0c0a06",
              opacity: hover==="song" ? 1 : 0.72,
              transition:"all 0.25s ease",
            }}>
            <span style={{ fontSize:20, width:40, height:40, borderRadius:12,
              display:"flex", alignItems:"center", justifyContent:"center",
              background:"rgba(255,190,11,0.05)", border:"1px solid rgba(255,190,11,0.1)", flexShrink:0 }}>🎵</span>
            <span style={{ display:"flex", flexDirection:"column", gap:2 }}>
              <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:15, fontWeight:800, color:"#c9bd97" }}>Build a Song</span>
                <span style={{ fontSize:8.5, fontWeight:800, letterSpacing:1, color:"#F77F00",
                  border:"1px solid rgba(247,127,0,0.4)", borderRadius:6, padding:"1px 6px" }}>BETA</span>
              </span>
              <span style={{ fontSize:11.5, fontWeight:600, color:"#5a5238" }}>Full song builder — sections, chords & strumming</span>
            </span>
            <span style={{ marginLeft:"auto", fontSize:20, fontWeight:900,
              color: hover==="song" ? "#FFBE0B" : "#332e22", transition:"color 0.25s" }}>›</span>
          </button>
        </div>

        <div style={{ marginTop:"auto", paddingTop:42, fontSize:11, color:"#332e22",
          textAlign:"center", ...rise(0.7) }}>
          © {new Date().getFullYear()} No Theory Club · All rights reserved.
        </div>
      </div>
    </div>
  );
}

// ─── DEFAULT EXPORT — App wrapped in the error boundary ──────────────────────
export default function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
