import { useState, useEffect, useRef, useCallback } from "react";
import { CHORD_IMAGES } from "./chordImages";
import { CHORD_AUDIO, DOWN_WAV, UP_WAV } from "./chordAudio";

// ─── DATA ───────────────────────────────────────────────────────────────────

const CHORD_PACKS = {
  1: { name: "Pack #1 — The Big 4", label: "Beginner Essential", chords: ["G","C","Em","D"], color: "#FFBE0B" },
  2: { name: "Pack #2 — Folk & Pop", label: "Minor Flavour", chords: ["Am","G","C","Fmaj7"], color: "#FFBE0B" },
  3: { name: "Pack #3 — Rock & Country", label: "Power Moves", chords: ["G","D","A","Bm"], color: "#FFD166" },
};

const STRUM_PATTERNS = {
  1: { name: "Pattern #1", active: [true,false,true,true,false,true,true,true], songs: ["Brown Eyed Girl","Good Riddance","I'm Yours"] },
  2: { name: "Pattern #2", active: [true,false,true,false,false,true,true,true], songs: ["Riptide","Wagon Wheel","Country Roads"] },
  3: { name: "Pattern #3", active: [true,false,false,false,true,false,true,true], songs: ["Sweet Home Alabama","Knockin' on Heaven's Door"] },
};

const DIRS16 = Array(16).fill(null).map((_,i) => i%2===0 ? "↓" : "↑");
const ALL_CHORDS = ["G","C","Em","D","Am","A","E","Dm","Bm","Fmaj7"];
const BEATS_OPTIONS = [1, 2, 4];

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
    const chordKeys = Object.keys(CHORD_AUDIO);
    const [generic, chordBufs] = await Promise.all([
      Promise.all([loadBuffer(ctx,DOWN_WAV), loadBuffer(ctx,UP_WAV)]),
      Promise.all(chordKeys.map(k => loadBuffer(ctx, CHORD_AUDIO[k])))
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
    playBuf(buf||(isDown?downRef.current:upRef.current), isDown?1.0:0.75, semitones);
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

  return { init, playClick, playStrum, playChordStrum, playChordClick, ready };
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("strum");
  const audio = useAudio();

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
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
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
        <ChordsTab audio={audio} />
      </div>
      <div style={{ display: tab==="song" ? "block" : "none" }}>
        <BuildSongTab audio={audio} />
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
  const [buildActive, setBuildActive] = useState(defaultBuild(8));
  const [hasSecondRow, setHasSecondRow] = useState(false);
  const [strumChord, setStrumChord] = useState("G"); // default G

  const STRUM_CHORDS = ["G", "C", "Em", "D"];

  const intervalRef = useRef(null);
  const beatRef = useRef(-1);
  const bpmRef = useRef(bpm);
  const totalBeatsRef = useRef(8);
  const modeRef = useRef(mode);
  const patternRef = useRef(pattern);
  const buildActiveRef = useRef(buildActive);
  const strumChordRef = useRef(strumChord);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ modeRef.current=mode; },[mode]);
  useEffect(()=>{ patternRef.current=pattern; },[pattern]);
  useEffect(()=>{ buildActiveRef.current=buildActive; },[buildActive]);
  useEffect(()=>{ strumChordRef.current=strumChord; },[strumChord]);
  useEffect(()=>{ totalBeatsRef.current = mode==="build"&&hasSecondRow ? 16 : 8; },[mode,hasSecondRow]);

  const tick = useCallback(()=>{
    const total=totalBeatsRef.current;
    const next=(beatRef.current+1)%total;
    beatRef.current=next;
    setCurrentBeat(next);
    if(next%4===0) playClick(next===0);
    const isDown=next%2===0;
    const cm=modeRef.current;
    let shouldStrum = cm==="build" ? buildActiveRef.current[next]===true
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

  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[bpm]);
  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[hasSecondRow]);
  useEffect(()=>()=>clearInterval(intervalRef.current),[]);

  const handleTogglePlay = async ()=>{
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    else{await init();startMetronome();setIsPlaying(true);}
  };

  const totalBlocks = mode==="build"&&hasSecondRow ? 16 : 8;
  const displayPattern = pattern ? pattern.active : Array(8).fill(true);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding:"24px 16px 48px", maxWidth:560, margin:"0 auto" }}>

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
                flex:1, padding:"8px 4px", borderRadius:10, border:"none",
                background: isActive ? "linear-gradient(135deg, #FFBE0B, #F77F00)" : "#1c1c1c",
                border: isActive ? "none" : "1px solid #2a2a2a",
                cursor:"pointer", transition:"all 0.15s",
                display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                boxShadow: isActive ? "0 0 12px rgba(255,190,11,0.4)" : "none",
              }}>
                {CHORD_IMAGES[chord] && (
                  <div style={{ width:"100%", borderRadius:6, opacity: isActive ? 1 : 0.5, overflow:"hidden" }}>
                    <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
                    <img src={CHORD_IMAGES[chord]} alt={chord}
                      style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
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
          currentBeat={currentBeat} isPlaying={isPlaying}
          stopMetronome={stopMetronome} setIsPlaying={setIsPlaying} />
      )}

      <MetronomePanel bpm={bpm} setBpm={setBpm} isPlaying={isPlaying}
        totalBlocks={totalBlocks} currentBeat={currentBeat}
        accentColor="#FFBE0B" onToggle={handleTogglePlay}
        canPlay={true} />
    </div>
  );
}

// ─── CHORDS TAB ─────────────────────────────────────────────────────────────
function ChordsTab({ audio }) {
  const { init, playChordClick, playChordStrum } = audio;
  const [viewMode, setViewMode] = useState("presets");
  const [selectedPack, setSelectedPack] = useState(null);
  const [customChords, setCustomChords] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(60);
  const [beatsPerChord, setBeatsPerChord] = useState(2);
  const [chordIndex, setChordIndex] = useState(0);
  const [beatCount, setBeatCount] = useState(0);

  const intervalRef = useRef(null);
  const beatRef = useRef(0);
  const chordRef = useRef(0);
  const bpmRef = useRef(bpm);
  const bpcRef = useRef(beatsPerChord);
  const packRef = useRef(selectedPack);
  const customRef = useRef(customChords);
  const vmRef = useRef(viewMode);
  const firstTickRef = useRef(true);

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ bpcRef.current=beatsPerChord; },[beatsPerChord]);
  useEffect(()=>{ packRef.current=selectedPack; },[selectedPack]);
  useEffect(()=>{ customRef.current=customChords; },[customChords]);
  useEffect(()=>{ vmRef.current=viewMode; },[viewMode]);

  const tick = useCallback(()=>{
    const chords = vmRef.current==="build" ? customRef.current
      : (packRef.current ? CHORD_PACKS[packRef.current].chords : []);
    if(!chords.length) return;
    const bpc=bpcRef.current, cur=beatRef.current, isFirst=cur===0;
    if(isFirst && !firstTickRef.current){
      const next=(chordRef.current+1)%chords.length;
      chordRef.current=next; setChordIndex(next);
    }
    firstTickRef.current=false;
    playChordClick(isFirst);
    // Play chord-specific strum on beat 1 (the accent beat)
    if(isFirst) playChordStrum(chords[chordRef.current], true);
    setBeatCount(cur);
    beatRef.current=(cur+1)%bpc;
  },[playChordClick, playChordStrum]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    beatRef.current=0; chordRef.current=0; firstTickRef.current=true;
    setChordIndex(0); setBeatCount(0);
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
  const nextChordIndex = chords.length>0 ? (chordIndex+1)%chords.length : 0;
  const accentColor = pack ? pack.color : "#FFBE0B";
  const isLastBeat = isPlaying && beatsPerChord>1 && beatCount===beatsPerChord-1;
  const canPlay = viewMode==="build" ? customChords.length>=2 : !!selectedPack;

  const handleTogglePlay = async ()=>{
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    else if(canPlay){await init();startMetronome();setIsPlaying(true);}
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding:"24px 16px 48px", maxWidth:560, margin:"0 auto" }}>

      <SectionHeader title="Chord Switching"
        sub={<>The goal is a clean chord <em style={{color:"#666"}}>before</em> the beat hits.</>} />

      <ModeTabs options={[["presets","🎵 Presets"],["build","🛠 Build Your Own"]]}
        value={viewMode} onChange={m=>{ setViewMode(m); stopMetronome(); setIsPlaying(false);
          setChordIndex(0); setBeatCount(0); beatRef.current=0; chordRef.current=0; }} />

      {viewMode==="presets" && (
        <div style={{ width:"100%", marginBottom:20 }}>
          <div style={{ fontSize:11, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:10 }}>CHOOSE A PACK</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[1,2,3].map(num=>{
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

      {viewMode==="build" && (
        <ChordPickerPanel customChords={customChords} setCustomChords={setCustomChords}
          maxChords={4} accentColor="#FFBE0B" isPlaying={isPlaying}
          stopMetronome={stopMetronome} setIsPlaying={setIsPlaying}
          setChordIndex={setChordIndex} setBeatCount={setBeatCount}
          beatRef={beatRef} chordRef={chordRef} />
      )}

      {chords.length>=2 && (
        <ChordGrid chords={chords} chordIndex={chordIndex} nextChordIndex={nextChordIndex}
          isPlaying={isPlaying} accentColor={accentColor} isLastBeat={isLastBeat}
          bpm={bpm} beatsPerChord={beatsPerChord} />
      )}

      {chords.length>=2 && (
        <div style={{ width:"100%", marginBottom:20 }}>
          <div style={{ fontSize:11, color:"#555", letterSpacing:2, textAlign:"center", marginBottom:10 }}>BEATS PER CHORD</div>
          <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
            {BEATS_OPTIONS.map(b=>(
              <button key={b} onClick={()=>{ setBeatsPerChord(b); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
                padding:"9px 26px", borderRadius:10,
                border: beatsPerChord===b ? `2px solid ${accentColor}` : "2px solid #2a2210",
                background: beatsPerChord===b ? `rgba(${hexToRgb(accentColor)},0.12)` : "#111",
                color: beatsPerChord===b ? accentColor : "#555",
                fontSize:15, fontWeight:800, cursor:"pointer",
              }}>{b}</button>
            ))}
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
    </div>
  );
}

// ─── BUILD A SONG TAB ────────────────────────────────────────────────────────
function BuildSongTab({ audio }) {
  const [buildMode, setBuildMode] = useState("simple"); // "simple" | "advanced"

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding:"24px 16px 48px", maxWidth:560, margin:"0 auto" }}>

      <SectionHeader title="🎵 Build a Song"
        sub="Build chords and strumming patterns together." />

      <ModeTabs options={[["simple","🎸 Simple"],["advanced","⚡ Advanced"]]}
        value={buildMode} onChange={setBuildMode} />

      {buildMode === "simple" && <SimpleBuildSong audio={audio} />}
      {buildMode === "advanced" && <AdvancedBuildSong audio={audio} />}
    </div>
  );
}

// ─── SIMPLE BUILD A SONG ─────────────────────────────────────────────────────
function SimpleBuildSong({ audio }) {
  const { init, playChordClick, playChordStrum } = audio;
  const [songChords, setSongChords] = useState([]);
  const [strumActive, setStrumActive] = useState(defaultBuild(8));
  const [hasSecondRow, setHasSecondRow] = useState(false);
  const [strumPatternBtn, setStrumPatternBtn] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(60);
  const [beatsPerChord, setBeatsPerChord] = useState(2);
  const [chordIndex, setChordIndex] = useState(0);
  const [beatCount, setBeatCount] = useState(0);
  const [currentStrum, setCurrentStrum] = useState(-1);

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

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ bpcRef.current=beatsPerChord; },[beatsPerChord]);
  useEffect(()=>{ chordsRef.current=songChords; },[songChords]);
  useEffect(()=>{ strumRef.current=strumActive; },[strumActive]);
  useEffect(()=>{ totalStrumRef.current=hasSecondRow?16:8; },[hasSecondRow]);

  const tick = useCallback(()=>{
    const chords=chordsRef.current;
    const bpc=bpcRef.current;
    const totalS=totalStrumRef.current;
    const nextStrum=(strumBeatRef.current+1)%totalS;
    strumBeatRef.current=nextStrum;
    setCurrentStrum(nextStrum);
    if(nextStrum===0 && !firstTickRef.current){
      const nextChordBeat=(chordBeatRef.current+1)%bpc;
      chordBeatRef.current=nextChordBeat;
      setBeatCount(nextChordBeat);
      if(nextChordBeat===0 && chords.length>0){
        const nextChord=(chordIdxRef.current+1)%chords.length;
        chordIdxRef.current=nextChord;
        setChordIndex(nextChord);
      }
    }
    firstTickRef.current=false;
    if(nextStrum%4===0) playChordClick(nextStrum===0);
    const isDown=nextStrum%2===0;
    if(strumRef.current[nextStrum]) {
      const currentChord=chordsRef.current[chordIdxRef.current];
      playChordStrum(currentChord, isDown);
    }
  },[playChordClick,playChordStrum]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    strumBeatRef.current=-1; chordIdxRef.current=0; chordBeatRef.current=0;
    firstTickRef.current=true;
    setChordIndex(0); setBeatCount(0); setCurrentStrum(-1);
    const ms=(60/bpmRef.current/4)*1000;
    intervalRef.current=setInterval(tick,ms);
    tick();
  },[tick]);

  const stopMetronome = useCallback(()=>{
    clearInterval(intervalRef.current); intervalRef.current=null;
    setCurrentStrum(-1); setChordIndex(0); setBeatCount(0);
    strumBeatRef.current=-1; chordIdxRef.current=0;
  },[]);

  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[bpm,beatsPerChord,hasSecondRow]);
  useEffect(()=>()=>clearInterval(intervalRef.current),[]);

  const canPlay = songChords.length>=2;
  const nextChordIndex = songChords.length>0?(chordIndex+1)%songChords.length:0;
  const isLastBeat = isPlaying&&beatsPerChord>1&&beatCount===beatsPerChord-1;
  const totalBlocks = hasSecondRow?16:8;

  const handleTogglePlay = async()=>{
    if(isPlaying){stopMetronome();setIsPlaying(false);}
    else if(canPlay){await init();startMetronome();setIsPlaying(true);}
  };

  return (
    <>
      <ChordPickerPanel customChords={songChords} setCustomChords={setSongChords}
        maxChords={6} accentColor="#FFBE0B" isPlaying={isPlaying}
        stopMetronome={stopMetronome} setIsPlaying={setIsPlaying}
        setChordIndex={setChordIndex} setBeatCount={setBeatCount}
        beatRef={chordIdxRef} chordRef={chordIdxRef} />

      {songChords.length>=2 && (
        <>
          <ChordGrid chords={songChords} chordIndex={chordIndex} nextChordIndex={nextChordIndex}
            isPlaying={isPlaying} accentColor="#FFBE0B" isLastBeat={isLastBeat}
            bpm={bpm} beatsPerChord={beatsPerChord} />
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

      <div style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a",
        borderRadius:20, padding:"18px 16px", marginBottom:20 }}>
        <div style={{ fontSize:11, color:"#888", letterSpacing:2, textAlign:"center", marginBottom:12 }}>STRUMMING PATTERN</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginBottom:16 }}>
          {[1,2,3].map(n=>(
            <PatternBtn key={n} label={`Pattern ${n}`} active={strumPatternBtn===n}
              onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                const pat=STRUM_PATTERNS[n].active;
                setStrumActive(prev=>{ const next=[...prev]; for(let i=0;i<8;i++) next[i]=pat[i]; return next; });
                setHasSecondRow(false); setStrumPatternBtn(n); }} />
          ))}
          <PatternBtn label="🎲 Random" active={strumPatternBtn==="random"} accent
            onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
              setStrumActive(generateRandomPattern().active); setStrumPatternBtn("random"); setHasSecondRow(false); }} />
        </div>
        <div style={{ fontSize:11, color:"#555", textAlign:"center", marginBottom:6, letterSpacing:1 }}>ROW 1</div>
        <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap", marginBottom:4 }}>
          {strumActive.slice(0,8).map((a,i)=>(
            <BuildBlock key={i} dir={DIRS16[i]} active={a} beat={currentStrum===i&&isPlaying}
              onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                setStrumActive(p=>p.map((v,idx)=>idx===i?!v:v)); setStrumPatternBtn(null); }} />
          ))}
        </div>
        {hasSecondRow && (
          <>
            <div style={{ fontSize:11, color:"#555", textAlign:"center", margin:"10px 0 6px", letterSpacing:1 }}>ROW 2</div>
            <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap", marginBottom:4 }}>
              {strumActive.slice(8,16).map((a,i)=>(
                <BuildBlock key={i+8} dir={DIRS16[i]} active={a} beat={currentStrum===i+8&&isPlaying}
                  onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                    setStrumActive(p=>p.map((v,idx)=>idx===i+8?!v:v)); setStrumPatternBtn(null); }} />
              ))}
            </div>
          </>
        )}
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:12 }}>
          {!hasSecondRow
            ? <button onClick={()=>{ setHasSecondRow(true); setStrumActive(p=>[...p.slice(0,8),...defaultBuild(8)]);
                if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
                padding:"8px 18px", borderRadius:10, border:"1px dashed #FFBE0B",
                background:"rgba(255,190,11,0.07)", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Add Row 2</button>
            : <button onClick={()=>{ setHasSecondRow(false); setStrumActive(p=>p.slice(0,8));
                if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
                padding:"8px 18px", borderRadius:10, border:"1px solid #2a2a2a",
                background:"transparent", color:"#666", fontSize:12, cursor:"pointer" }}>− Remove Row 2</button>
          }
          <button onClick={()=>{ setStrumActive(defaultBuild(hasSecondRow?16:8)); setStrumPatternBtn(null); }} style={{
            padding:"8px 14px", borderRadius:10, border:"1px solid #2a2a2a",
            background:"transparent", color:"#444", fontSize:12, cursor:"pointer" }}>Reset</button>
        </div>
      </div>

      <MetronomePanel bpm={bpm} setBpm={setBpm} isPlaying={isPlaying}
        totalBlocks={totalBlocks} currentBeat={currentStrum}
        accentColor="#FFBE0B" onToggle={handleTogglePlay}
        canPlay={canPlay} disabledLabel="Select 2+ chords to start" />
    </>
  );
}

// ─── ADVANCED BUILD A SONG ───────────────────────────────────────────────────
function AdvancedBuildSong({ audio }) {
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
  const [chordPickerOpen, setChordPickerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(60);
  const [currentStrum, setCurrentStrum] = useState(-1);
  const [currentFlatIdx, setCurrentFlatIdx] = useState(-1);
  const [currentChordLabel, setCurrentChordLabel] = useState(null);
  const [muteMetronome, setMuteMetronome] = useState(false);
  const [capo, setCapo] = useState(0);
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
    if(!muteRef.current && next%4===0) playChordClick(next===0);
    const isDown=next%2===0;
    if(strumRef.current[flatIdx] && currentChordRef.current) playChordStrum(currentChordRef.current, isDown, capoRef.current);
  },[playChordClick,playChordStrum]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    strumBeatRef.current=-1; currentChordRef.current=null;
    setCurrentStrum(-1); setCurrentChordLabel(null);
    const ms=(60/bpmRef.current/4)*1000;
    intervalRef.current=setInterval(tick,ms);
    tick();
  },[tick]);

  const stopMetronome = useCallback(()=>{
    clearInterval(intervalRef.current); intervalRef.current=null;
    setCurrentStrum(-1); strumBeatRef.current=-1;
    setCurrentFlatIdx(-1);
    setCurrentChordLabel(null); currentChordRef.current=null;
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
    setShowSaved(false);
  };

  const handleDelete = (id) => {
    const updated = savedPatterns.filter(p=>p.id!==id);
    setSavedPatterns(updated);
    localStorage.setItem("ntc_patterns", JSON.stringify(updated));
  };

  const handleTogglePlay = async()=>{
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
      {/* Chord carousel display */}
      <div style={{ width:"100%", marginBottom:16 }}>
        {/* Position dots for assigned chords */}
        {assignedChords.length > 0 && (
          <div style={{ display:"flex", justifyContent:"center", gap:5, marginBottom:10 }}>
            {assignedChords.map((c,i)=>(
              <div key={i} style={{
                width: c===currentChordLabel ? 18 : 6, height:6, borderRadius:3,
                background: c===currentChordLabel ? "#FFBE0B" : "#2a2a2a",
                transition:"all 0.25s ease",
              }} />
            ))}
          </div>
        )}

        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {/* Prev */}
          <div style={{ flex:"0 0 22%", display:"flex", flexDirection:"column", alignItems:"center", opacity:0.22 }}>
            {prevChordLabel && (
              <>
                <div style={{ width:"100%", borderRadius:10, overflow:"hidden", background:"#000", border:"1px solid #111" }}>
                  {CHORD_IMAGES[prevChordLabel]
                    ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
                        <img src={CHORD_IMAGES[prevChordLabel]} alt={prevChordLabel}
                          style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                      </div>
                    : <div style={{ aspectRatio:"3/4", display:"flex", alignItems:"center",
                        justifyContent:"center", fontSize:20, fontWeight:900, color:"#333" }}>{prevChordLabel}</div>
                  }
                </div>
                <div style={{ marginTop:4, fontSize:12, fontWeight:900, color:"#444" }}>{prevChordLabel}</div>
              </>
            )}
          </div>

          {/* Current — center */}
          <div style={{ flex:"0 0 56%", display:"flex", flexDirection:"column", alignItems:"center" }}>
            <div style={{ width:"100%", borderRadius:14, overflow:"hidden", background:"#000",
              border: currentChordLabel ? `2px solid #FFBE0B` : "1px solid #2a2a2a",
              boxShadow: currentChordLabel ? "0 0 24px rgba(255,190,11,0.45)" : "none" }}>
              {currentChordLabel && CHORD_IMAGES[currentChordLabel]
                ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
                    <img src={CHORD_IMAGES[currentChordLabel]} alt={currentChordLabel}
                      style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                  </div>
                : <div style={{ aspectRatio:"3/4", display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:36, fontWeight:900,
                    color: currentChordLabel ? "#FFBE0B" : "#2a2a2a" }}>
                    {currentChordLabel || "?"}
                  </div>
              }
            </div>
            <div style={{ marginTop:6, fontSize:19, fontWeight:900,
              color: currentChordLabel ? "#FFBE0B" : "#333" }}>
              {currentChordLabel || "Assign chords to blocks"}
            </div>
          </div>

          {/* Next */}
          <div style={{ flex:"0 0 22%", display:"flex", flexDirection:"column", alignItems:"center", opacity:0.22 }}>
            {nextChordLabel && (
              <>
                <div style={{ width:"100%", borderRadius:10, overflow:"hidden", background:"#000", border:"1px solid #111" }}>
                  {CHORD_IMAGES[nextChordLabel]
                    ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
                        <img src={CHORD_IMAGES[nextChordLabel]} alt={nextChordLabel}
                          style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                      </div>
                    : <div style={{ aspectRatio:"3/4", display:"flex", alignItems:"center",
                        justifyContent:"center", fontSize:20, fontWeight:900, color:"#333" }}>{nextChordLabel}</div>
                  }
                </div>
                <div style={{ marginTop:4, fontSize:12, fontWeight:900, color:"#444" }}>{nextChordLabel}</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ width:"100%", background:"#0a0a0a", border:"1px solid #2a2a2a",
        borderRadius:20, padding:"18px 16px", marginBottom:20 }}>
        <div style={{ fontSize:11, color:"#888", letterSpacing:2, textAlign:"center", marginBottom:12 }}>STRUMMING PATTERN</div>

        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:14, flexWrap:"wrap" }}>
          <button onClick={()=>setAssignMode(m=>!m)} style={{
            padding:"8px 16px", borderRadius:10,
            border: assignMode ? "2px solid #FFBE0B" : "1px solid #2a2a2a",
            background: assignMode ? "rgba(255,190,11,0.12)" : "#111",
            color: assignMode ? "#FFBE0B" : "#666",
            fontSize:12, fontWeight:700, cursor:"pointer",
          }}>{assignMode ? "🎸 Strumming" : "✏️ Assign Chords"}</button>

          {assignMode && (
            <button onClick={()=>setChordPickerOpen(p=>!p)} style={{
              padding:"8px 16px", borderRadius:10, border:"1px solid #2a2a2a",
              background:"#111", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer",
            }}>Chord: <strong>{assignChord}</strong> ▾</button>
          )}

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

        {assignMode && chordPickerOpen && (
          <div style={{ background:"#111", border:"1px solid #2a2a2a", borderRadius:14,
            padding:"12px", marginBottom:12,
            display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
            {ALL_CHORDS.map(c=>(
              <button key={c} onClick={()=>{ setAssignChord(c); setChordPickerOpen(false); }} style={{
                padding:"6px 4px", borderRadius:8, border:"none",
                background: assignChord===c ? "linear-gradient(135deg,#FFBE0B,#F77F00)" : "#1c1c1c",
                color: assignChord===c ? "#111" : "#888",
                fontSize:11, fontWeight:800, cursor:"pointer",
              }}>{c}</button>
            ))}
          </div>
        )}

        {assignMode && (
          <div style={{ textAlign:"center", fontSize:11, color:"#555", marginBottom:10 }}>
            Tap a block to assign <span style={{ color:"#FFBE0B" }}>{assignChord}</span> · tap again to remove · press <strong style={{color:"#888"}}>Strumming</strong> when done
          </div>
        )}

        {(() => {
          const offsets = getRowOffsets(rowSizes);
          return rowSizes.map((rowSize, rowIdx)=>{
            const offset = offsets[rowIdx];
            const cycleSize = rowSize===8 ? 4 : rowSize===4 ? 6 : 8;
            const sizeLabel = rowSize===6 ? "Triplet" : rowSize===4 ? "4" : "8";
            return (
              <div key={rowIdx} style={{ marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:5 }}>
                  <div style={{ fontSize:10, color:"#444", letterSpacing:1 }}>ROW {rowIdx+1}</div>
                  <button onClick={()=>{
                    if(isPlaying){stopMetronome();setIsPlaying(false);}
                    setRowSizes(p=>p.map((s,i)=>i===rowIdx?cycleSize:s));
                  }} style={{
                    padding:"2px 8px", borderRadius:6, border:"1px solid #333",
                    background:"#1a1a1a", color:"#FFBE0B", fontSize:9,
                    fontWeight:700, cursor:"pointer",
                  }}>{sizeLabel} ↻</button>
                  <button onClick={()=>{
                    if(isPlaying){stopMetronome();setIsPlaying(false);}
                    setRowRepeats(p=>p.map((r,i)=>i===rowIdx?(r>=4?1:r+1):r));
                  }} style={{
                    padding:"2px 8px", borderRadius:6, border:"1px solid #333",
                    background: (rowRepeats[rowIdx]||1)>1 ? "rgba(255,190,11,0.15)" : "#1a1a1a",
                    color: (rowRepeats[rowIdx]||1)>1 ? "#FFBE0B" : "#555",
                    fontSize:9, fontWeight:700, cursor:"pointer",
                  }}>{rowRepeats[rowIdx]||1}× 🔁</button>
                </div>
                <div style={{ display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap" }}>
                  {Array(rowSize).fill(null).map((_,colIdx)=>{
                    const i = offset+colIdx;
                    const assignedChord=blockChords[i];
                    return (
                      <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <BuildBlock dir={DIRS16[colIdx%8]} active={strumActive[i]} beat={currentFlatIdx===i&&isPlaying}
                          assigned={!!assignedChord} onClick={()=>handleBlockClick(i)} />
                        <div style={{ fontSize:8, fontWeight:800, height:10,
                          color: assignedChord ? "#FFBE0B" : "transparent" }}>{assignedChord||"·"}</div>
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
          {rowSizes.length>1 && <button onClick={()=>{ setRowSizes(p=>p.slice(0,-1)); setRowRepeats(p=>p.slice(0,-1)); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
            padding:"8px 16px", borderRadius:10, border:"1px solid #2a2a2a",
            background:"transparent", color:"#666", fontSize:12, cursor:"pointer" }}>− Remove Row</button>}
          <button onClick={()=>{ 
            const arr = defaultBuild(8);
            while(arr.length < 80) arr.push(false);
            setStrumActive(arr);
            setBlockChords(Array(80).fill(null));
            setRowSizes([8]); setRowRepeats([1]); if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
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
                  <button onClick={()=>handleDelete(p.id)} style={{
                    padding:"7px 10px", borderRadius:9, border:"1px solid #333",
                    background:"transparent", color:"#555", fontSize:13, cursor:"pointer" }}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MetronomePanel bpm={bpm} setBpm={setBpm} isPlaying={isPlaying}
        totalBlocks={8} currentBeat={currentStrum}
        accentColor="#FFBE0B" onToggle={handleTogglePlay}
        canPlay={true} />
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
  isPlaying, stopMetronome, setIsPlaying, setChordIndex, setBeatCount, beatRef, chordRef }) {
  return (
    <div style={{ width:"100%", background:"#0a0a0a",
      border:"1px solid #2a2a2a", borderRadius:20, padding:"16px 14px", marginBottom:20,
      boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
      <div style={{ fontSize:11, color:"#888", letterSpacing:2, textAlign:"center", marginBottom:4 }}>
        {maxChords===6 ? "PICK YOUR CHORDS" : "BUILD YOUR CHORD SET"}
      </div>
      <div style={{ fontSize:12, color:"#555", textAlign:"center", marginBottom:14 }}>
        {customChords.length}/{maxChords} selected
        {customChords.length>=2 && <span style={{ color:"#FFD166", marginLeft:8 }}>→ {customChords.join(" → ")}</span>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
        {ALL_CHORDS.map(chord=>{
          const isSel=customChords.includes(chord);
          const isDis=!isSel&&customChords.length>=maxChords;
          return (
            <button key={chord} disabled={isDis}
              onClick={()=>{
                if(isPlaying){stopMetronome();setIsPlaying(false);}
                setCustomChords(p=>isSel?p.filter(c=>c!==chord):[...p,chord]);
                setChordIndex(0); setBeatCount(0);
                if(beatRef) beatRef.current=0;
                if(chordRef) chordRef.current=0;
              }} style={{
              borderRadius:10, padding:"0 0 5px",
              background:"#000",
              border: isSel ? `2px solid ${accentColor}` : "2px solid #2a2210",
              cursor:isDis?"not-allowed":"pointer", opacity:isDis?0.25:1,
              display:"flex", flexDirection:"column", alignItems:"center",
              transition:"all 0.15s", overflow:"hidden",
              boxShadow:isSel?`0 0 10px rgba(${hexToRgb(accentColor)},0.3)`:"none",
            }}>
              {CHORD_IMAGES[chord]
                ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
                    <img src={CHORD_IMAGES[chord]} alt={chord}
                      style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
                  </div>
                : <div style={{ width:"100%", aspectRatio:"3/4", display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:16, fontWeight:900,
                    color:isSel?accentColor:"#333" }}>{chord}</div>
              }
              <div style={{ fontSize:10, fontWeight:800, color:isSel?accentColor:"#555", marginTop:3 }}>{chord}</div>
            </button>
          );
        })}
      </div>
      {customChords.length<2 && (
        <div style={{ textAlign:"center", fontSize:11, color:"#555", marginTop:12 }}>
          Select at least 2 chords to start
        </div>
      )}
    </div>
  );
}

function ChordGrid({ chords, chordIndex, nextChordIndex, isPlaying, accentColor, isLastBeat, bpm, beatsPerChord }) {
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
                {CHORD_IMAGES[chord]
                  ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
                    <img src={CHORD_IMAGES[chord]} alt={chord}
                      style={{ width:"120%", height:"auto", display:"block", flexShrink:0 }} />
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
    </div>
  );
}

function ChordCard({ chord, isActive, accentColor }) {
  return (
    <div style={{ width:"100%", borderRadius:10, overflow:"hidden", background:"#000",
      border: isActive ? `2px solid ${accentColor}` : "1px solid #111",
      boxShadow: isActive ? `0 0 20px rgba(${hexToRgb(accentColor)},0.4)` : "none" }}>
      {CHORD_IMAGES[chord]
        ? <div style={{ width:"100%", overflow:"hidden", display:"flex", justifyContent:"center" }}>
            <img src={CHORD_IMAGES[chord]} alt={chord}
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
  currentBeat, isPlaying, stopMetronome, setIsPlaying }) {
  return (
    <div style={{ width:"100%", background:"#0a0a0a",
      border:"1px solid #2a2a2a", borderRadius:20, padding:"18px 16px", marginBottom:20 }}>
      <div style={{ fontSize:11, color:"#888", letterSpacing:2, textAlign:"center", marginBottom:4 }}>BUILD YOUR PATTERN</div>
      <p style={{ textAlign:"center", fontSize:12, color:"#888", marginBottom:16 }}>Tap blocks to toggle active ↔ ghost</p>
      <div style={{ fontSize:11, color:"#555", textAlign:"center", marginBottom:6, letterSpacing:1 }}>ROW 1</div>
      <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap", marginBottom:4 }}>
        {buildActive.slice(0,8).map((a,i)=>(
          <BuildBlock key={i} dir={DIRS16[i]} active={a} beat={currentBeat===i&&isPlaying}
            onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
              setBuildActive(p=>p.map((v,idx)=>idx===i?!v:v)); }} />
        ))}
      </div>
      {hasSecondRow && (
        <>
          <div style={{ fontSize:11, color:"#555", textAlign:"center", margin:"10px 0 6px", letterSpacing:1 }}>ROW 2</div>
          <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap" }}>
            {buildActive.slice(8,16).map((a,i)=>(
              <BuildBlock key={i+8} dir={DIRS16[i]} active={a} beat={currentBeat===i+8&&isPlaying}
                onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                  setBuildActive(p=>p.map((v,idx)=>idx===i+8?!v:v)); }} />
            ))}
          </div>
        </>
      )}
      <div style={{ display:"flex", justifyContent:"center", gap:10, marginTop:16 }}>
        {!hasSecondRow
          ? <button onClick={()=>{ setHasSecondRow(true);
              setBuildActive(p=>[...p.slice(0,8),...defaultBuild(8)]);
              if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
              padding:"8px 18px", borderRadius:10, border:"1px dashed #FFBE0B",
              background:"rgba(247,127,0,0.08)", color:"#F77F00",
              fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Add Second Row</button>
          : <button onClick={()=>{ setHasSecondRow(false);
              setBuildActive(p=>p.slice(0,8));
              if(isPlaying){stopMetronome();setIsPlaying(false);} }} style={{
              padding:"8px 18px", borderRadius:10, border:"1px solid #2a2a2a",
              background:"transparent", color:"#666", fontSize:12, cursor:"pointer" }}>− Remove Row 2</button>
        }
        <button onClick={()=>setBuildActive(defaultBuild(hasSecondRow?16:8))} style={{
          padding:"8px 14px", borderRadius:10, border:"1px solid #2a2a2a",
          background:"transparent", color:"#444", fontSize:12, cursor:"pointer" }}>Reset</button>
      </div>
    </div>
  );
}

function MetronomePanel({ bpm, setBpm, isPlaying, totalBlocks, currentBeat, accentColor,
  onToggle, canPlay, disabledLabel }) {
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
        background:!canPlay?"#111009":isPlaying
          ?"linear-gradient(135deg,#c0392b,#e74c3c)"
          :"linear-gradient(135deg,#1a6b3c,#27ae60)",
        color:!canPlay?"#333":"#fff", fontSize:16, fontWeight:800,
        cursor:canPlay?"pointer":"not-allowed",
        boxShadow:!canPlay?"none":isPlaying?"0 4px 20px rgba(231,76,60,0.4)":"0 4px 20px rgba(39,174,96,0.4)",
        transition:"all 0.2s" }}>
        {!canPlay?(disabledLabel||"Select options to start"):isPlaying?"⏹ Stop":"▶ Start"}
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
