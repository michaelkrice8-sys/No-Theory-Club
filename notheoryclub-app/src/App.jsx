import { useState, useEffect, useRef, useCallback, Component } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@supabase/supabase-js";
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
          <button onClick={()=>{
              // Recover from a render crash. For a shared package link (?pkg=) keep
              // the query string so the user reloads INTO their package instead of
              // being dropped onto the full-app landing page (free-access seal).
              // For any other view, reset to the clean home URL as before.
              const isPkg = typeof window !== "undefined" &&
                new URLSearchParams(window.location.search).has("pkg");
              window.location.href = isPkg
                ? window.location.href
                : window.location.origin + window.location.pathname;
            }}
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

// Global slider styling (thick, easy-to-grab gold knob). Defined once so it is
// available everywhere a .ntc-bpm-slider appears, not just inside MetronomePanel.
const NTC_SLIDER_CSS = `
  .ntc-bpm-slider { -webkit-appearance:none; appearance:none; width:100%; height:30px;
    background:transparent; cursor:pointer; outline:none; }
  .ntc-bpm-slider::-webkit-slider-runnable-track { height:10px; border-radius:99px; background:#241d10; }
  .ntc-bpm-slider::-moz-range-track { height:10px; border-radius:99px; background:#241d10; }
  .ntc-bpm-slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none;
    width:30px; height:30px; margin-top:-10px; border-radius:50%;
    background:radial-gradient(circle at 35% 30%, #FFE27A, #FFBE0B 55%, #F77F00);
    border:2px solid #1a1208; box-shadow:0 0 12px rgba(255,170,20,0.5); cursor:pointer; }
  .ntc-bpm-slider::-moz-range-thumb { width:28px; height:28px; border-radius:50%;
    background:radial-gradient(circle at 35% 30%, #FFE27A, #FFBE0B 55%, #F77F00);
    border:2px solid #1a1208; box-shadow:0 0 12px rgba(255,170,20,0.5); cursor:pointer; }
`;

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

// ─── ACCESS CONTROL ──────────────────────────────────────────────────────────
// Auth client (magic-link login + session persistence). Separate from the raw
// REST helpers below, which continue to power Song Builder share links.
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_KEY);

// Package links that are open to EVERYONE, no login required. The free-course
// trial package lives here. Add more IDs to open more packages.
const PUBLIC_PACKAGES = ["983c3ac1", "7cb3898c", "e44930d9", "d1a9001e"];

// Where the upgrade button sends non-premium users.
const UPGRADE_URL = "https://www.skool.com/notheoryclub/plans";

// Shared chrome for the gate screens (login / wall) — matches app branding.
function GateShell({ children }) {
  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:"28px",
      background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff", textAlign:"center" }}>
      <div style={{ fontSize:22, fontWeight:800, letterSpacing:3, marginBottom:6,
        background:"linear-gradient(135deg,#FFD166,#F77F00)",
        WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>NO THEORY CLUB</div>
      <div style={{ fontSize:13, color:"#8a8578", letterSpacing:2.5, textTransform:"uppercase", marginBottom:30 }}>Guitar Practice Tool</div>
      {children}
    </div>
  );
}

function GateButton({ onClick, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding:"16px 34px", borderRadius:16,
        border:"1.5px solid " + (disabled ? "rgba(247,143,30,0.3)" : "rgba(247,143,30,0.75)"),
        background: disabled ? "rgba(247,143,30,0.03)" : "rgba(247,143,30,0.08)",
        boxShadow: disabled ? "none" : "0 0 26px rgba(247,127,0,0.28)",
        color: disabled ? "#9a8f70" : "#FFD166", fontSize:19, fontWeight:800,
        fontFamily:"'Trebuchet MS', sans-serif",
        cursor: disabled ? "default" : "pointer", minWidth:250 }}>
      {children}
    </button>
  );
}

// Login screen — email in, magic link out. No passwords.
// Pre-checks membership so free members see the upgrade screen
// immediately instead of receiving a pointless email.
function GateLogin() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notPremium, setNotPremium] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState("");

  // Verify the 6-digit code from the email — signs the member in RIGHT HERE,
  // in whatever browser they're standing in. No link, no browser roulette.
  const verifyCode = async () => {
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) { setCodeError("The code is 6 digits — check the email."); return; }
    setVerifying(true); setCodeError("");
    try {
      const { error: err } = await supabaseAuth.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: "email"
      });
      if (err) throw err;
      // Success: onAuthStateChange fires and the gate takes over from here.
    } catch (ex) {
      setCodeError("That code didn't work — double-check it, or request a fresh one. Codes expire after a few minutes.");
      setVerifying(false);
    }
  };

  const send = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setError("Please enter a valid email address."); return; }
    setBusy(true); setError("");
    try {
      // Pre-flight: is this email premium? If the check itself fails,
      // proceed with the normal flow (never block a real member).
      try {
        const chk = await fetch("https://notheoryclub.com/.netlify/functions/check-member?email=" + encodeURIComponent(e));
        if (chk.ok) {
          const info = await chk.json();
          if (info && info.premium === false) {
            setNotPremium(true);
            setBusy(false);
            return;
          }
        }
      } catch (_) { /* check unavailable — carry on */ }

      const { error: err } = await supabaseAuth.auth.signInWithOtp({
        email: e,
        options: { emailRedirectTo: window.location.href }
      });
      if (err) throw err;
      setSent(true);
    } catch (ex) {
      setError("Couldn't send the link. Please try again in a minute.");
    }
    setBusy(false);
  };

  if (notPremium) return (
    <GateShell>
      <div style={{ fontSize:52, marginBottom:16 }}>🔒</div>
      <div style={{ fontSize:26, fontWeight:900, marginBottom:12, maxWidth:520 }}>The Practice App is for Premium members</div>
      <div style={{ fontSize:17, color:"#b5ae9d", lineHeight:1.75, maxWidth:430, marginBottom:26 }}>
        Unlimited practice drills, the 30 Day Tracker, the Song Builder, and
        everything else — it all comes with No Theory Club Premium.
      </div>
      <GateButton onClick={()=>{ window.location.href = UPGRADE_URL; }}>Upgrade to Premium</GateButton>
      <div style={{ fontSize:15, color:"#8a8578", lineHeight:1.85, marginTop:26, maxWidth:400 }}>
        Already Premium? Make sure you use your <b style={{color:"#b5ae9d"}}>Skool account email</b>.<br/>
        <span onClick={()=>{ setNotPremium(false); setEmail(""); }}
          style={{ color:"#FFD166", cursor:"pointer", textDecoration:"underline" }}>
          Try a different email
        </span>
      </div>
    </GateShell>
  );

  if (sent) return (
    <GateShell>
      <div style={{ fontSize:52, marginBottom:16 }}>📬</div>
      <div style={{ fontSize:26, fontWeight:900, marginBottom:14 }}>Check your email</div>
      <div style={{ fontSize:17, color:"#b5ae9d", lineHeight:1.75, maxWidth:400, marginBottom:22 }}>
        We sent a <b style={{color:"#e8e2d2"}}>6-digit code</b> to{" "}
        <span style={{ color:"#FFD166", fontWeight:700 }}>{email.trim()}</span>.<br/>
        Type it below and you're in.
      </div>
      <input type="text" inputMode="numeric" autoComplete="one-time-code"
        value={code} placeholder="123456" maxLength={6}
        onChange={(e)=>setCode(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e)=>{ if(e.key==="Enter") verifyCode(); }}
        style={{ width:"100%", maxWidth:320, padding:"16px 18px", borderRadius:16,
          border:"1px solid rgba(255,209,102,0.35)", background:"rgba(255,209,102,0.04)",
          color:"#FFD166", fontSize:30, fontWeight:800, letterSpacing:9, marginBottom:16,
          outline:"none", textAlign:"center",
          fontFamily:"'Trebuchet MS', sans-serif", boxSizing:"border-box" }} />
      {codeError && <div style={{ fontSize:15, color:"#ff7a6b", marginBottom:12, maxWidth:380 }}>{codeError}</div>}
      <GateButton onClick={verifyCode} disabled={verifying}>{verifying ? "Checking…" : "Sign in"}</GateButton>
      <div style={{ fontSize:15, color:"#8a8578", lineHeight:1.8, marginTop:24, maxWidth:400 }}>
        The email also has a sign-in link — the code and the link both work.<br/>
        No email after a couple of minutes? Check your spam folder —
        or DM me on Skool and I'll sort you out.
      </div>
    </GateShell>
  );

  return (
    <GateShell>
      <div style={{ fontSize:52, marginBottom:16 }}>🎸</div>
      <div style={{ fontSize:26, fontWeight:900, marginBottom:12 }}>Members sign in here</div>
      <div style={{ fontSize:17, color:"#b5ae9d", lineHeight:1.75, maxWidth:400, marginBottom:26 }}>
        Enter the email you use for your <b style={{color:"#e8e2d2"}}>Skool account</b> and
        we'll email you a sign-in code. No password needed.
      </div>
      <input type="email" value={email} placeholder="you@example.com"
        onChange={(e)=>setEmail(e.target.value)}
        onKeyDown={(e)=>{ if(e.key==="Enter") send(); }}
        style={{ width:"100%", maxWidth:380, padding:"16px 18px", borderRadius:16,
          border:"1px solid rgba(255,209,102,0.35)", background:"rgba(255,209,102,0.04)",
          color:"#fff", fontSize:18, marginBottom:16, outline:"none", textAlign:"center",
          fontFamily:"'Trebuchet MS', sans-serif", boxSizing:"border-box" }} />
      {error && <div style={{ fontSize:15, color:"#ff7a6b", marginBottom:12 }}>{error}</div>}
      <GateButton onClick={send} disabled={busy}>{busy ? "Sending…" : "Email me a sign-in code"}</GateButton>
      <div style={{ fontSize:15, color:"#8a8578", marginTop:22, maxWidth:380, lineHeight:1.7 }}>
        Don't receive the link? DM me on Skool and I'll sort you out.
      </div>
    </GateShell>
  );
}

// The wall — signed in, but not premium.
function GateWall({ email, onSignOut }) {
  return (
    <GateShell>
      <div style={{ fontSize:52, marginBottom:16 }}>🔒</div>
      <div style={{ fontSize:26, fontWeight:900, marginBottom:12, maxWidth:520 }}>The Practice App is for Premium members</div>
      <div style={{ fontSize:17, color:"#b5ae9d", lineHeight:1.75, maxWidth:430, marginBottom:26 }}>
        Unlimited practice drills, the 30 Day Tracker, the Song Builder, and
        everything else — it all comes with No Theory Club Premium.
      </div>
      <GateButton onClick={()=>{ window.location.href = UPGRADE_URL; }}>Upgrade to Premium</GateButton>
      <div style={{ fontSize:15, color:"#8a8578", lineHeight:1.85, marginTop:26, maxWidth:400 }}>
        Already Premium? Make sure you signed in with your <b style={{color:"#b5ae9d"}}>Skool account email</b>.<br/>
        Signed in as <span style={{ color:"#b5ae9d" }}>{email}</span> —{" "}
        <span onClick={onSignOut} style={{ color:"#FFD166", cursor:"pointer", textDecoration:"underline" }}>
          use a different email
        </span>
      </div>
    </GateShell>
  );
}

// ─── PROGRESS SYNC ───────────────────────────────────────────────────────────
// Mirrors the app's localStorage progress to the Supabase `progress` table for
// logged-in premium members, so streaks/drills/songs follow them across
// devices and survive cleared caches. localStorage stays the working copy;
// the cloud is the durable one.

const BUILD_UNLOCK_KEY   = "ntc-build-unlocked-v1"; // {unlocked:true, at:ISO}
const CELEBRATED_KEY     = "ntc-30day-celebrated-v1"; // {unlocked:true, at:ISO} — trophy modal shown once, ever
const CUSTOM_TRACKER_KEY = "ntc-custom-tracker-v1"; // {config, data, updatedAt} or {deleted:true, updatedAt}
const SYNC_KEYS = [
  "ntc_drills", "ntc_patterns", "ntc_songs", "ntc_strum", "ntc_strum_tab",
  "ntc-30day-tracker-v1", CUSTOM_TRACKER_KEY, BUILD_UNLOCK_KEY, CELEBRATED_KEY,
  "ntc-generated-v1", "ntc-songbuilder-v1"
];
const TRACKER_KEY = "ntc-30day-tracker-v1";

function syncReadLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// Tracker merge: union of completed tasks, day by day. Practising on two
// devices should never erase a ticked box on either.
function mergeTracker(local, cloud) {
  if (!Array.isArray(local)) return Array.isArray(cloud) ? cloud : null;
  if (!Array.isArray(cloud)) return local;
  const len = Math.max(local.length, cloud.length);
  const merged = [];
  for (let i = 0; i < len; i++) {
    const a = local[i] || {}, b = cloud[i] || {};
    const day = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      day[k] = Boolean(a[k]) || Boolean(b[k]);
    }
    merged.push(day);
  }
  return merged;
}

// List merge: union with de-duplication (by exact content). Never loses a
// saved item; a deletion made on one device may reappear from another —
// the safe direction for practice data.
function mergeList(local, cloud) {
  if (!Array.isArray(local)) return Array.isArray(cloud) ? cloud : null;
  if (!Array.isArray(cloud)) return local;
  const seen = new Set();
  const merged = [];
  for (const item of [...local, ...cloud]) {
    const sig = JSON.stringify(item);
    if (!seen.has(sig)) { seen.add(sig); merged.push(item); }
  }
  return merged;
}

// Unlock-flag merge: once unlocked anywhere, unlocked everywhere. A member
// who earned Build on their phone must never see it re-locked on their laptop.
function mergeUnlock(local, cloud) {
  const unlocked = Boolean(local && local.unlocked) || Boolean(cloud && cloud.unlocked);
  if (!unlocked) return local || cloud || null;
  return { unlocked: true, at: (local && local.at) || (cloud && cloud.at) || new Date().toISOString() };
}

// Custom (Build) tracker merge: newest config wins by updatedAt. If both sides
// share the same shape (same day count + task ids), union the ticked boxes so
// practising on two devices never erases a check — same rule as the 30-day
// tracker. A {deleted:true} tombstone counts as newest like anything else, so
// deletions propagate instead of resurrecting.
function mergeCustomTracker(local, cloud) {
  if (!local) return cloud || null;
  if (!cloud) return local;
  const lt = Date.parse(local.updatedAt || 0) || 0;
  const ct = Date.parse(cloud.updatedAt || 0) || 0;
  const newer = ct > lt ? cloud : local;
  const older = ct > lt ? local : cloud;
  const ids = (c) => JSON.stringify(((c && c.tasks) || []).map(t => t.id));
  const sameShape = newer.config && older.config &&
    newer.config.days === older.config.days && ids(newer.config) === ids(older.config);
  if (sameShape) {
    const data = mergeTracker(newer.data, older.data);
    return data ? { ...newer, data } : newer;
  }
  return newer;
}

// Pull cloud progress, merge with local, write back to BOTH sides.
// Runs once per login, before the app renders.
async function syncPullAndMerge(userId) {
  try {
    const { data: rows, error } = await supabaseAuth
      .from("progress").select("key, data");
    if (error) throw error;

    const cloud = {};
    for (const r of (rows || [])) cloud[r.key] = r.data;

    const toPush = [];
    for (const key of SYNC_KEYS) {
      const local = syncReadLocal(key);
      const remote = key in cloud ? cloud[key] : null;
      const merged =
          key === TRACKER_KEY        ? mergeTracker(local, remote)
        : key === CUSTOM_TRACKER_KEY ? mergeCustomTracker(local, remote)
        : (key === BUILD_UNLOCK_KEY || key === CELEBRATED_KEY) ? mergeUnlock(local, remote)
        : mergeList(local, remote);
      if (merged == null) continue;
      try { localStorage.setItem(key, JSON.stringify(merged)); } catch (_) {}
      if (JSON.stringify(merged) !== JSON.stringify(remote)) {
        toPush.push({ user_id: userId, key, data: merged, updated_at: new Date().toISOString() });
      }
    }
    if (toPush.length) {
      await supabaseAuth.from("progress").upsert(toPush, { onConflict: "user_id,key" });
    }
  } catch (e) {
    console.log("progress sync (pull) skipped:", e && e.message ? e.message : e);
  }
}

// Watch localStorage for changes and push them up, debounced. Uses snapshot
// comparison so the app's existing save code needs no changes at all.
function startSyncWatcher(userId) {
  const snapshots = {};
  for (const key of SYNC_KEYS) {
    snapshots[key] = localStorage.getItem(key) || "";
  }

  let pending = {};
  let pushTimer = null;

  const flush = async () => {
    const rows = Object.keys(pending).map((key) => ({
      user_id: userId, key,
      data: (() => { try { return JSON.parse(pending[key]); } catch (_) { return null; } })(),
      updated_at: new Date().toISOString()
    })).filter(r => r.data != null);
    pending = {};
    if (!rows.length) return;
    try {
      await supabaseAuth.from("progress").upsert(rows, { onConflict: "user_id,key" });
    } catch (e) {
      console.log("progress sync (push) failed:", e && e.message ? e.message : e);
    }
  };

  const check = () => {
    for (const key of SYNC_KEYS) {
      const now = localStorage.getItem(key) || "";
      if (now !== snapshots[key]) {
        snapshots[key] = now;
        if (now) pending[key] = now;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(flush, 2500);
      }
    }
  };

  const interval = setInterval(check, 3000);
  const onHide = () => { check(); clearTimeout(pushTimer); flush(); };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide();
  });
  window.addEventListener("beforeunload", onHide);

  return () => { clearInterval(interval); clearTimeout(pushTimer); };
}

// AccessGate — decides what renders:
//   • Public package link (?pkg= on the allowlist)  → app, no login
//   • Not signed in                                  → login screen
//   • Signed in, premium                             → app
//   • Signed in, not premium                         → the wall
function AccessGate({ children }) {
  const [phase, setPhase] = useState("checking"); // checking | login | syncing | wall | open
  const [userEmail, setUserEmail] = useState("");
  const watcherRef = useRef(null);
  const openedForRef = useRef(null); // user id the gate has already evaluated

  // Stop the sync watcher if the gate ever unmounts.
  useEffect(() => () => { if (watcherRef.current) watcherRef.current(); }, []);

  // Public trial package bypasses everything.
  const isPublicPkg = (() => {
    try {
      const pkg = new URLSearchParams(window.location.search).get("pkg");
      return pkg != null && PUBLIC_PACKAGES.includes(pkg);
    } catch (_) { return false; }
  })();

  useEffect(() => {
    if (isPublicPkg) { setPhase("open"); return; }
    let cancelled = false;

    const evaluate = async (session) => {
      if (cancelled) return;
      if (!session) { openedForRef.current = null; setPhase("login"); return; }
      // Same user, already evaluated (e.g. token refresh on tab focus):
      // do nothing — never unmount the app underneath the member.
      if (openedForRef.current === session.user.id) return;
      openedForRef.current = session.user.id;
      const email = (session.user?.email || "").toLowerCase();
      setUserEmail(email);
      try {
        const { data, error } = await supabaseAuth
          .from("members").select("tier").maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        if (data && data.tier === "premium") {
          // Pull cloud progress and merge BEFORE the app renders, so streaks
          // and saved items are present on first paint on any device.
          setPhase("syncing");
          await Promise.race([
            syncPullAndMerge(session.user.id),
            new Promise((res) => setTimeout(res, 6000)) // never block practice
          ]);
          if (cancelled) return;
          if (!watcherRef.current) watcherRef.current = startSyncWatcher(session.user.id);
          setPhase("open");
        } else {
          setPhase("wall");
        }
      } catch (_) {
        // If the membership check itself fails (network blip), fail CLOSED to
        // the wall rather than granting access — but never crash the app.
        if (!cancelled) setPhase("wall");
      }
    };

    // NOTE: never run Supabase queries synchronously inside the auth callback —
    // it holds an internal lock and deadlocks the client. Defer with setTimeout.
    let running = false;
    const evaluateDeferred = (session) => {
      setTimeout(async () => {
        if (running || cancelled) return;
        running = true;
        try { await evaluate(session); } finally { running = false; }
      }, 0);
    };
    supabaseAuth.auth.getSession().then(({ data }) => evaluateDeferred(data.session));
    const { data: sub } = supabaseAuth.auth.onAuthStateChange((_event, session) => evaluateDeferred(session));
    return () => { cancelled = true; sub?.subscription?.unsubscribe(); };
  }, [isPublicPkg]);

  const signOut = async () => {
    try { await supabaseAuth.auth.signOut(); } catch (_) {}
    openedForRef.current = null;
    setPhase("login");
  };

  if (phase === "open") return children;
  if (phase === "login") return <GateLogin />;
  if (phase === "wall") return <GateWall email={userEmail} onSignOut={signOut} />;
  if (phase === "syncing") return (
    <GateShell>
      <div style={{ fontSize:44, marginBottom:14 }}>🎸</div>
      <div style={{ fontSize:16, color:"#8a8578" }}>Loading your progress…</div>
    </GateShell>
  );
  return (
    <GateShell>
      <div style={{ fontSize:44, marginBottom:14 }}>🎸</div>
      <div style={{ fontSize:16, color:"#8a8578" }}>Loading…</div>
    </GateShell>
  );
}

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

// ─── PACKAGE STORAGE ─────────────────────────────────────────────────────────
// A "package" bundles several exercises (chord drill / strum / song) plus an
// optional tracker into one shareable ?pkg= link. Stored in its own `packages`
// table (id text PK auto-gen, name text, data jsonb). Each item's `d` payload is
// produced by the EXISTING per-type encoders, so packages never change how a
// single exercise is serialized — they only wrap an ordered array of them.
async function packageInsert(name, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/packages`, {
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

async function packageFetch(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/packages?id=eq.${id}&select=*`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if(!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  return rows[0] || null;
}

// Accounts allowed into the legacy Build-a-Song authoring suite (dev tools).
// Checked against the authenticated Supabase session email — no login, no access.
const DEV_EMAILS = ["michael.k.rice8@gmail.com"];

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
function encodeChordDrill(chords, bpm, beatsPerChord, name, variants, random) {
  return btoa(JSON.stringify({ c: chords, b: bpm, p: beatsPerChord, n: name||"", v: variants||{}, r: random?1:0 }));
}
function decodeChordDrill(str) {
  try {
    const obj = JSON.parse(atob(str));
    return { chords: Array.isArray(obj.c)?obj.c:[], bpm: Number(obj.b)||60, beatsPerChord: Number(obj.p)||2, name: obj.n||"", chordVariants: obj.v||{}, random: !!obj.r };
  } catch { return null; }
}

// ─── STRUM PATTERN URL ENCODING ─────────────────────────────────────────────
// rowSizes: array of 1-8 entries, each 4/6/8. Each row occupies 8 slots in strumActive
// (row N = indices [N*8, N*8+rowSizes[N])). strumActive total length should be 64.
function encodeStrumDrill(name, strumActive, rowSizes, songChords, bpm, beatsPerChord, chordVariants, capo, random) {
  const sa = strumActive.reduce((acc,v,i)=>{ if(v) acc.push(i); return acc; },[]);
  const rs = Array.isArray(rowSizes) ? rowSizes : [8];
  // Keep old fields for backward compat with older client versions
  const r2 = rs.length>=2 ? 1 : 0;
  const s1 = rs[0]||8;
  const s2 = rs[1]||8;
  return btoa(JSON.stringify({ n:name, sa, rs, r2, s1, s2, c:songChords, b:bpm, p:beatsPerChord, v:chordVariants||{}, cp:capo||0, rnd: random?1:0 }));
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
      random: !!obj.rnd,
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
    // On iOS, audio respects the hardware mute switch unless the page declares a
    // "playback" audio session. Where supported (iOS Safari 16.4+) this lets the
    // metronome/chords be heard in silent mode. Harmless / ignored elsewhere.
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch (e) {}
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
  const [hasSharedPackage] = useState(() => typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("pkg"));

  const [buildMode, setBuildMode] = useState(
    hasSharedPattern ? "advanced"
    : hasSharedSong ? "song"
    : "simple"
  );
  const audio = useAudio();
  const [chordVariants, setChordVariants] = useState({G:"G",C:"C",Em:"Em",D:"D",Am:"Am",A:"A",E:"E",Dm:"Dm",Bm:"Bm","Fmaj7":"Fmaj7"});

  // Dev-tools access, resolved from the live Supabase session.
  const [isDev, setIsDev] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabaseAuth.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const email = ((data && data.session && data.session.user && data.session.user.email) || "").toLowerCase();
      setIsDev(DEV_EMAILS.includes(email));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const updateVariant = (chord, variant) => setChordVariants(p=>({...p,[chord]:variant}));

  // Landing screen: shown on a clean load (no shared exercise URL). Shared links
  // hit the early returns below and never reach this, so they skip the landing.
  const [view, setView] = useState("landing"); // "landing" | "app"
  // Which destination the user picked from the landing. "song" routes to the
  // hidden Build-a-Song (beta) view; the others are the 3 main tabs.
  const [dest, setDest] = useState(null); // "strum" | "chords" | "tracker" | "song"

  // Paint the page background (html/body) with the same warm radial glow as the
  // app, and tint the mobile browser chrome to match, so the top/bottom strips
  // blend into the background's glow instead of reading as flat black.
  useEffect(() => {
    const GRADIENT = "radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)";
    const TOP_TONE = "#14100a"; // warm tone for the browser chrome (between glow and base)
    try {
      document.documentElement.style.background = GRADIENT;
      document.documentElement.style.backgroundColor = "#0d0d0a";
      document.body.style.background = GRADIENT;
      document.body.style.backgroundColor = "#0d0d0a";
      document.body.style.margin = "0";
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
      meta.setAttribute("content", TOP_TONE);
    } catch (_) {}
  }, []);

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
    // Tell whichever tab is playing to stop (it listens for this event). This
    // avoids passing reactive props that would trigger cross-component updates.
    try { window.dispatchEvent(new Event("ntc-stop-playback")); } catch(e){}
    setDest(newTab);
  };

  const tabs = [
    { id:"strum",   label:"🎸 Strumming" },
    { id:"chords",  label:"🤚 Chords" },
    { id:"song",    label:"🎵 Song" },
    { id:"tracker", label:"🔥 Tracker" },
  ];

  // Share view — clean layout, no tabs
  const anyShared = hasSharedSong || hasSharedDrill || hasSharedStrum || hasSharedStrumProg || hasSharedPattern || hasSharedPackage;

  // A package link (?pkg=) renders the combined multi-exercise share view. It
  // owns its full-page layout (pinned streak strip + bottom nav), so render it
  // bare, before the other shared returns.
  if(hasSharedPackage) return <PackageShareView audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />;

  // SongBuilder controls its OWN full-page layout (sticky header, fixed bottom bar).
  // Render it bare so we don't constrain it inside a maxWidth wrapper.
  if(hasSharedSong) return <SongBuilder audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />;

  if(anyShared) return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" }}>
      <style>{NTC_SLIDER_CSS}</style>
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
    return <LandingScreen onPick={pickFromLanding} streak={landingStreak}
      isDev={isDev} onDev={() => { setView("app"); setDest("devtools"); }} />;
  }

  // ── Dev tools — the legacy Build-a-Song authoring suite (Simple / Advanced /
  // Song / Package). Founder-only: reached via the small button on the Song tab,
  // and only rendered when the Supabase session email is on DEV_EMAILS. The
  // landing's "Song Practice" card now falls through to the member-facing Song
  // tab in the main shell instead. ──
  if(dest === "devtools" && isDev) {
    return (
      <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
        fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" }}>
        <div style={{ textAlign:"center", padding:"16px 16px 12px" }}>
          <span onClick={goHome} style={{ display:"inline-block", cursor:"pointer", fontSize:18, fontWeight:900,
            letterSpacing:1.5, background:"linear-gradient(135deg,#FFE27A,#FFBE0B 50%,#F77F00)",
            WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent",
            filter:"drop-shadow(0 2px 10px rgba(255,140,0,0.18))" }}>NO THEORY CLUB</span>
          <div style={{ fontSize:10, color:"#6f6749", letterSpacing:2, marginTop:3, textTransform:"uppercase" }}>
            Dev Tools <span style={{ color:"#F77F00", fontWeight:800 }}>· Founder</span>
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

  // ── Main app: 4-tab shell (Strumming / Chords / Song / Tracker) ──
  const activeTab = dest || "strum";
  return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" }}>
      <style>{NTC_SLIDER_CSS}</style>

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
        <div style={{ display: activeTab==="song" ? "block" : "none" }}>
          <SongBuilderTab audio={audio} chordVariants={chordVariants} updateVariant={updateVariant}
            isDev={isDev} onOpenDev={() => setDest("devtools")} />
        </div>
        <div style={{ display: activeTab==="tracker" ? "block" : "none" }}>
          <TrackerTab />
        </div>
      </div>

      {/* Exercise Generator — opened by the launcher on any tracker */}
      <ExerciseGeneratorHost audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} context="app" />
    </div>
  );
}

// ─── STRUMMING TAB ──────────────────────────────────────────────────────────
// ─── CHORD CAROUSEL ──────────────────────────────────────────────────────────
// Real draggable carousel: the track follows the pointer in real time, then
// snaps to the nearest card on release (a fast flick advances one). Tapping a
// peeking side card or a dot slides+locks to it. Calls onChange with the locked
// chord name. Uses regular (non-anchored) chord images.
const CAROUSEL_CARD_W = 150;
const CAROUSEL_CARD_MARGIN = 10;
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
      c.style.transform = `scale(${(1 - 0.16 * t).toFixed(3)})`;
      c.style.opacity = (1 - 0.5 * t).toFixed(3);
      const on = i === n;
      c.style.borderColor = on ? "rgba(255,190,11,0.6)" : "#222";
      c.style.boxShadow = on ? "0 0 22px rgba(255,160,20,0.26)" : "none";
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
        style={{ position:"relative", width:"100%", height:250, overflow:"hidden",
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
                style={{ flex:"0 0 auto", width:CAROUSEL_CARD_W, height:210,
                  margin:`0 ${CAROUSEL_CARD_MARGIN}px`, borderRadius:14, border:"1px solid #222",
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

function StrummingTab({ audio, sharedView=false, active=true, initialParam=null, onExport=null, hideTitle=false, anchored=false }) {
  const { init, playClick, playStrum, playChordStrum } = audio;
  const [mode, setMode] = useState(onExport ? "build" : "practice");
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

  // "Anchor chords" (package view): swap the strummed chord to its anchored shape.
  const STRUM_ANCHOR = { "G":"G_anchor", "C":"C_anchor", "Em":"Em_anchor", "D":"D_anchor" };
  const STRUM_UNANCHOR = { "G_anchor":"G", "C_anchor":"C", "Em_anchor":"Em", "D_anchor":"D" };
  useEffect(()=>{
    setStrumChord(prev => {
      if(anchored) return STRUM_ANCHOR[prev] || prev;
      return STRUM_UNANCHOR[prev] || prev;
    });
  // eslint-disable-next-line
  },[anchored]);
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
    if(next%2===0) playClick(next===0);
    const isDown = (cm==="build" ? mappedIdx : next)%2===0;
    let shouldStrum = cm==="build" ? buildActiveRef.current[mappedIdx]===true
      : patternRef.current ? patternRef.current.active[next]===true : true;
    if(shouldStrum) playChordStrum(strumChordRef.current, isDown);
  },[playClick, playChordStrum]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    beatRef.current=-1;
    const ms=(60/bpmRef.current/2)*1000;
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
    const params = new URLSearchParams(initialParam!=null ? "" : window.location.search);
    const encoded = initialParam!=null ? initialParam : params.get("strum");
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
        setBuilderOpen(onExport ? true : false);
        // Keep the share param in the URL so a refresh reloads this, not the home page.
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

  // Stop playback when this tab is left (app tab switch fires "ntc-stop-playback")
  // or the browser tab is hidden/backgrounded — so a drill never keeps running
  // out of sight. Listener-based so it never triggers cross-component renders.
  useEffect(()=>{
    const stop = ()=>{
      clearInterval(countdownRef.current); countdownRef.current=null;
      setCountdown(0); stopMetronome(); setIsPlaying(false);
    };
    const onHide = ()=>{ if(document.hidden) stop(); };
    window.addEventListener("ntc-stop-playback", stop);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", stop);
    return ()=>{
      window.removeEventListener("ntc-stop-playback", stop);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", stop);
    };
  }, [stopMetronome]); // eslint-disable-line

  const totalBlocks = mode==="build" ? rowSizes.reduce((a,b)=>a+b,0) : 8;
  const displayPattern = pattern ? pattern.active : Array(8).fill(true);

  // Export current build pattern as a strum payload (for the Package builder).
  const exportPayload = () => {
    const ba=[...buildActive]; while(ba.length<64) ba.push(false);
    return encodeStrumDrill(sharedViewName||"Strum", ba, rowSizes, [], bpm, 2, {}, 0);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding: sharedView ? "12px 0" : "24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      {onExport && (
        <div style={{ width:"100%", marginBottom:12 }}>
          <button onClick={()=>onExport("strum", exportPayload(), "Strum pattern")}
            style={{ width:"100%", padding:"12px", borderRadius:12,
              border:"1px solid rgba(255,190,11,0.5)",
              background:"radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.2) 0%, rgba(255,170,30,0) 70%), #16110a",
              color:"#FFD60A", fontSize:14, fontWeight:900, cursor:"pointer", fontFamily:"inherit" }}>
            ✓ Use this in package
          </button>
        </div>
      )}

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
        <ChordCarousel chords={anchored ? STRUM_CHORDS.map(c=>STRUM_ANCHOR[c]||c) : STRUM_CHORDS} value={strumChord} onChange={setStrumChord} />
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
          sharedViewName={hideTitle ? null : sharedViewName} />
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
function ChordsTab({ audio, chordVariants, updateVariant, sharedView=false, active=true, initialParam=null, onExport=null, anchored=false }) {
  const { init, playChordClick, playChordStrum } = audio;
  const [viewMode, setViewMode] = useState(onExport ? "build" : "presets");
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
    const params = new URLSearchParams(initialParam!=null ? "" : window.location.search);
    const drill = initialParam!=null ? initialParam : params.get("drill");
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
        setPickerOpen(onExport ? true : false);
        setRandomOrder(!!decoded.random);
        randomOrderRef.current = !!decoded.random;
        if(decoded.chordVariants && Object.keys(decoded.chordVariants).length > 0)
          Object.entries(decoded.chordVariants).forEach(([c,v])=>updateVariant(c,v));
        // Keep the share param in the URL so a refresh reloads this, not the home page.
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
  // Pre-built queue of upcoming chord indices for random mode. We always keep
  // plenty queued ahead and refill from the END (off-screen), so a chord is
  // finalized long before it slides into view — the user never sees it change.
  const queueRef = useRef([]);
  const [randomNext2, setRandomNext2] = useState(0); // the chord after next (for the peek)
  const [randomPrev, setRandomPrev] = useState(0); // the real previous chord (left peek)

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ bpcRef.current=beatsPerChord; },[beatsPerChord]);
  useEffect(()=>{ packRef.current=selectedPack; },[selectedPack]);
  useEffect(()=>{ customRef.current=customChords; },[customChords]);
  useEffect(()=>{ vmRef.current=viewMode; },[viewMode]);
  useEffect(()=>{ randomOrderRef.current=randomOrder; },[randomOrder]);

  // "Anchor chords" (package view): swap base chords to anchored shapes live,
  // without remounting. Mapping both directions makes it timing-proof — it works
  // no matter when the chords loaded relative to the toggle. Only G/C/Em/D have an
  // anchored shape; others are untouched.
  const ANCHOR_SWAP = { "G":"G_anchor", "C":"C_anchor", "Em":"Em_anchor", "D":"D_anchor" };
  const ANCHOR_UNSWAP = { "G_anchor":"G", "C_anchor":"C", "Em_anchor":"Em", "D_anchor":"D" };
  useEffect(()=>{
    setCustomChords(prev => {
      if(!prev || !prev.length) return prev;
      const next = prev.map(c => anchored ? (ANCHOR_SWAP[c] || c) : (ANCHOR_UNSWAP[c] || c));
      if(next.length===prev.length && next.every((c,i)=>c===prev[i])) return prev;
      return next;
    });
  // eslint-disable-next-line
  },[anchored, customChords.length]);

  // Fisher–Yates shuffle of [0..len-1]. If `avoidFirst` is given, ensures the
  // first element differs from it (so no repeat across a block seam).
  const makeShuffle = (len, avoidFirst=null) => {
    const a = Array.from({length:len},(_,i)=>i);
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    if(avoidFirst!=null && len>1 && a[0]===avoidFirst){ [a[0],a[1]]=[a[1],a[0]]; }
    return a;
  };
  // Append one fresh shuffled block to the queue, avoiding a repeat at the seam.
  const refillQueue = (len) => {
    const q = queueRef.current;
    const last = q.length ? q[q.length-1] : null;
    queueRef.current = q.concat(makeShuffle(len, last));
  };
  // Ensure at least `min` items are queued ahead.
  const ensureQueue = (len, min=8) => {
    while(queueRef.current.length < min) refillQueue(len);
  };

  const tick = useCallback(()=>{
    const chords = vmRef.current==="build" ? customRef.current
      : (packRef.current ? CHORD_PACKS[packRef.current].chords : []);
    if(!chords.length) return;
    const bpc=bpcRef.current, cur=beatRef.current, isFirst=cur===0;
    if(isFirst && !firstTickRef.current){
      if(randomOrderRef.current && chords.length>1){
        const len = chords.length;
        // The chord that was current becomes the real "previous" (left peek).
        setRandomPrev(chordRef.current);
        // Pull the next chord off the front of the pre-built queue.
        ensureQueue(len, 8);
        const incoming = queueRef.current.shift();
        chordRef.current = incoming;
        setChordIndex(incoming);
        // The next two are already decided (off-screen) — expose for the slide.
        ensureQueue(len, 8);
        randomNextRef.current = queueRef.current[0];
        setRandomNextDisplay(queueRef.current[0]);
        setRandomNext2(queueRef.current[1]);
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
    beatRef.current=0; firstTickRef.current=true;
    setBeatCount(0);
    if(randomOrderRef.current) {
      // Random mode: the first chord + queue were already settled when randomize
      // was toggled on (so the display was random before Start). Keep them — just
      // start playing from the current chord. Only build if somehow empty.
      const total = vmRef.current==="build" ? customRef.current.length : (packRef.current?CHORD_PACKS[packRef.current].chords.length:1);
      if(total > 1) {
        if(queueRef.current.length < 2){
          queueRef.current = [];
          ensureQueue(total, 12);
          chordRef.current = queueRef.current.shift();
          ensureQueue(total, 12);
        }
        setChordIndex(chordRef.current);
        randomNextRef.current = queueRef.current[0];
        setRandomNextDisplay(queueRef.current[0]);
        setRandomNext2(queueRef.current[1]);
      }
    } else {
      chordRef.current=0; setChordIndex(0);
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
    // In random mode, settle the shuffled starting chord + lookahead NOW (before the
    // countdown) so the displayed chord during 3-2-1 is the real first chord and
    // doesn't jump when playback begins.
    if(randomOrderRef.current){
      const total = vmRef.current==="build" ? customRef.current.length : (packRef.current?CHORD_PACKS[packRef.current].chords.length:1);
      if(total > 1){
        queueRef.current = [];
        ensureQueue(total, 12);
        chordRef.current = queueRef.current.shift();
        ensureQueue(total, 12);
        setChordIndex(chordRef.current);
        randomNextRef.current = queueRef.current[0];
        setRandomNextDisplay(queueRef.current[0]);
        setRandomNext2(queueRef.current[1]);
      }
    }
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

  // Stop playback when this tab is left (app tab switch fires "ntc-stop-playback")
  // or the browser tab is hidden/backgrounded. Listener-based to avoid any
  // cross-component renders.
  useEffect(()=>{
    const stop = ()=>{
      clearInterval(countdownRef.current); countdownRef.current=null;
      setCountdown(0); stopMetronome(); setIsPlaying(false);
    };
    const onHide = ()=>{ if(document.hidden) stop(); };
    window.addEventListener("ntc-stop-playback", stop);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", stop);
    return ()=>{
      window.removeEventListener("ntc-stop-playback", stop);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", stop);
    };
  }, [stopMetronome]); // eslint-disable-line

  // Export current build-mode drill as a drill payload (for the Package builder).
  const exportPayload = () => encodeChordDrill(customChords, bpm, beatsPerChord, loadedDrillName||"Chords", {...chordVariants}, randomOrder);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding: sharedView ? "12px 0" : "24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      {onExport && (
        <div style={{ width:"100%", marginBottom:12 }}>
          <button onClick={()=>onExport("drill", exportPayload(), loadedDrillName||(customChords.length?customChords.map(slotLabel).join(" "):"Chords"))}
            disabled={customChords.length<2}
            style={{ width:"100%", padding:"12px", borderRadius:12,
              border:"1px solid rgba(255,190,11,0.5)",
              background: customChords.length<2 ? "#100d09" : "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.2) 0%, rgba(255,170,30,0) 70%), #16110a",
              color: customChords.length<2 ? "#3a3528" : "#FFD60A", fontSize:14, fontWeight:900,
              cursor: customChords.length<2 ? "not-allowed" : "pointer", fontFamily:"inherit" }}>
            ✓ Use this in package
          </button>
        </div>
      )}

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
          afterChordIndex={randomOrder ? randomNext2 : null}
          prevChordIndex={randomOrder ? randomPrev : null}
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
              if(next && chords.length>1){
                // Randomize the FIRST chord immediately (before Start) and
                // pre-build the upcoming queue so the whole display is random now.
                const len = chords.length;
                queueRef.current = [];
                ensureQueue(len, 12);
                const curr = queueRef.current.shift();
                ensureQueue(len, 12);
                chordRef.current = curr;
                setChordIndex(curr);
                randomNextRef.current = queueRef.current[0];
                setRandomNextDisplay(queueRef.current[0]);
                setRandomNext2(queueRef.current[1]);
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
function BuildSongTab({ audio, initialBuildMode="simple", chordVariants, updateVariant, sharedView=false, initialParam=null, hideTitle=false, anchored=false }) {
  const [buildMode, setBuildMode] = useState(initialBuildMode);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      padding: sharedView ? "12px 0" : "24px 16px 12px", maxWidth:560, margin:"0 auto" }}>

      {!sharedView && (
        <>
          <SectionHeader title="🎵 Build a Song"
            sub="Build chords and strumming patterns together." />

          <ModeTabs options={[["simple","🎸 Simple"],["advanced","⚡ Advanced"],["song","📋 Song"],["package","📦 Package"]]}
            value={buildMode} onChange={setBuildMode} />
        </>
      )}

      {buildMode === "simple" && <SimpleBuildSong audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} sharedView={sharedView} initialParam={initialParam} hideTitle={hideTitle} anchored={anchored} />}
      {buildMode === "advanced" && <AdvancedBuildSong audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} sharedView={sharedView} initialParam={initialParam} hideTitle={hideTitle} />}
      {buildMode === "song" && <SongBuilder audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />}
      {buildMode === "package" && <PackageBuilderTab audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />}
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

    // Click every 2 blocks = quarter note (each block is an 8th note)
    if(!muteRef.current && beat % 2 === 0)
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
    const ms = (60/bpmRef.current/2)*1000; // 8th note per block
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
    const ms = (60/bpmRef.current/2)*1000;
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
    const ms = (60/bpmRef.current/2)*1000;
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
    // Fixed 3 → 2 → 1 count-in (1s per beep), matching Chords & Strumming.
    let beat = 3, beatIdx = 0;
    setCountIn(beat); setCountInBeat(beatIdx); playChordClick(true);
    countInRef.current = setInterval(()=>{
      beat--; beatIdx += 2;
      if(beat <= 0){
        clearInterval(countInRef.current);
        setCountIn(0); setCountInBeat(-1);
        const ms16 = (60/bpmRef.current/2)*1000;
        intervalRef.current = setInterval(tick, ms16);
        tick();
        setIsPlaying(true);
      } else {
        setCountIn(beat); setCountInBeat(beatIdx%8); playChordClick(false);
      }
    }, 1000);
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
      const ms16 = (60/bpmRef.current/2)*1000;
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
    // Fixed 3 → 2 → 1 count-in (1s per beep), matching Chords & Strumming.
    let beat=3, beatIdx=0;
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
        const ms16 = (60/bpmRef.current/2)*1000;
        intervalRef.current = setInterval(tick, ms16);
        tick();
        setIsPlaying(true);
      } else {
        setCountIn(beat); setCountInBeat(beatIdx%8); playChordClick(false);
      }
    }, 1000);
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
        // Keep the share param so a refresh reloads this, not the home page.
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
        // Keep the share param so a refresh reloads this, not the home page.
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

function SimpleBuildSong({ audio, chordVariants, updateVariant, sharedView=false, initialParam=null, onExport=null, hideTitle=false, anchored=false }) {
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
  const [songRandom, setSongRandom] = useState(false); // shuffle chord order each loop
  const [countIn, setCountIn] = useState(0);
  // Song-mode chord slide: chord holds static through the run-throughs, then a
  // quick slide is triggered near the end of the final run-through.
  const [slideSignal, setSlideSignal] = useState(0); // increment = "start the slide now"
  const [slideDurMs, setSlideDurMs] = useState(380);
  const slideArmedRef = useRef(false); // prevents double-triggering within a run

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
  const songRandomRef = useRef(false);
  const shuffleQueueRef = useRef([]); // upcoming shuffled chord indices for random mode
  // Carousel peeks for random mode (so the carousel can slide to the real next chord)
  const [songNextDisplay, setSongNextDisplay] = useState(0);
  const [songNext2, setSongNext2] = useState(0);
  const [songPrev, setSongPrev] = useState(0);

  // Fisher–Yates shuffle of [0..len-1]; if avoidFirst given, ensure first differs.
  const makeSongShuffle = (len, avoidFirst=null) => {
    const a = Array.from({length:len},(_,i)=>i);
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    if(avoidFirst!=null && len>1 && a[0]===avoidFirst){ [a[0],a[1]]=[a[1],a[0]]; }
    return a;
  };
  const refillSongQueue = (len) => {
    const q = shuffleQueueRef.current;
    const last = q.length ? q[q.length-1] : null;
    shuffleQueueRef.current = q.concat(makeSongShuffle(len, last));
  };
  const ensureSongQueue = (len, min=8) => {
    while(shuffleQueueRef.current.length < min) refillSongQueue(len);
  };

  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  useEffect(()=>{ bpcRef.current=beatsPerChord; },[beatsPerChord]);
  useEffect(()=>{ chordsRef.current=songChords; },[songChords]);

  // "Anchor chords" (package view): keep song chords in sync with the anchored
  // setting. Runs both when the toggle flips AND when chords first load (so a
  // package saved as already-anchored shows anchored shapes from the start).
  // Loop-safe: only writes when the current chords don't already match the target.
  const SONG_ANCHOR_SWAP = { "G":"G_anchor", "C":"C_anchor", "Em":"Em_anchor", "D":"D_anchor" };
  const SONG_ANCHOR_UNSWAP = { "G_anchor":"G", "C_anchor":"C", "Em_anchor":"Em", "D_anchor":"D" };
  useEffect(()=>{
    setSongChords(prev => {
      if(!prev || !prev.length) return prev;
      const next = prev.map(c => anchored ? (SONG_ANCHOR_SWAP[c] || c) : (SONG_ANCHOR_UNSWAP[c] || c));
      // Avoid a state update (and render loop) if nothing actually changes.
      if(next.length===prev.length && next.every((c,i)=>c===prev[i])) return prev;
      return next;
    });
  // eslint-disable-next-line
  },[anchored, songChords.length]);
  useEffect(()=>{ strumRef.current=strumActive; },[strumActive]);
  useEffect(()=>{
    row1SizeRef.current=row1Size; row2SizeRef.current=row2Size;
    hasSecondRowRef.current=hasSecondRow;
    totalStrumRef.current=hasSecondRow?row1Size+row2Size:row1Size;
  },[row1Size,row2Size,hasSecondRow]);
  useEffect(()=>{ capoRef.current=capo; },[capo]);
  useEffect(()=>{ songRandomRef.current=songRandom; },[songRandom]);

  // Load from URL on mount
  useEffect(()=>{
    const params = new URLSearchParams(initialParam!=null ? "" : window.location.search);
    const encoded = initialParam!=null ? initialParam : params.get("strumprog");
    if(encoded){
      const d = decodeStrumDrill(encoded);
      if(d){
        setSongChords(d.songChords); setStrumActive(d.strumActive);
        setHasSecondRow(d.hasSecondRow); setRow1Size(d.row1Size); setRow2Size(d.row2Size);
        setBpm(d.bpm); setBeatsPerChord(d.beatsPerChord); setCapo(d.capo||0);
        setSongRandom(!!d.random); songRandomRef.current = !!d.random;
        setLoadedName(d.name); setSaveName(d.name);
        setPickerOpen(onExport ? true : false);
        if(d.chordVariants) Object.entries(d.chordVariants).forEach(([c,v])=>updateVariant(c,v));
        // Keep the share param in the URL so a refresh reloads this, not the home page.
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
        if(songRandomRef.current && chords.length>1){
          const len = chords.length;
          // Current becomes the real "previous" (left peek).
          setSongPrev(chordIdxRef.current);
          // Pull next off the pre-built queue; keep ≥8 queued so peeks are known.
          ensureSongQueue(len, 8);
          const incoming = shuffleQueueRef.current.shift();
          chordIdxRef.current = incoming; setChordIndex(incoming);
          ensureSongQueue(len, 8);
          setSongNextDisplay(shuffleQueueRef.current[0]);
          setSongNext2(shuffleQueueRef.current[1]);
        } else {
          const nextChord=(chordIdxRef.current+1)%chords.length;
          chordIdxRef.current=nextChord; setChordIndex(nextChord);
        }
      }
    }
    // ── Song-mode chord slide trigger ──
    // The chord holds static while the pattern runs. On the final run-through of
    // this chord, start the slide exactly 2 arrows before the wrap (the 7th arrow
    // of an 8-arrow row) so the next chord lands in focus right as the chord changes.
    if(chords.length>1){
      const onFinalRun = chordBeatRef.current === bpc-1;
      const tickMs = (60/bpmRef.current/2)*1000;
      const lead = 2; // always begin sliding 2 arrows before the switch
      const slideStartRaw = (totalS - lead + totalS) % totalS;
      if(onFinalRun && nextRaw===slideStartRaw && !slideArmedRef.current && !firstTickRef.current){
        slideArmedRef.current = true;
        setSlideDurMs(lead*tickMs);
        setSlideSignal(s=>s+1);
      }
      // Re-arm once we've passed the switch (new run-through begins).
      if(nextRaw===0) slideArmedRef.current = false;
    }
    firstTickRef.current=false;
    if(nextRaw%2===0) playChordClick(nextRaw===0);
    const isDown=strumIdx%2===0;
    if(strumRef.current[strumIdx]){
      const currentChord=chordsRef.current[chordIdxRef.current];
      if(currentChord) playChordStrum(getAudioKey(currentChord, chordVariants), isDown, capoRef.current);
    }
  },[playChordClick,playChordStrum,chordVariants]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    strumBeatRef.current=-1; chordBeatRef.current=0;
    firstTickRef.current=true; slideArmedRef.current=false;
    if(songRandomRef.current && chordsRef.current.length>1){
      // Random mode: settle a shuffled start + lookahead (don't reset to chord 0).
      const len = chordsRef.current.length;
      if(shuffleQueueRef.current.length < 3){
        shuffleQueueRef.current = [];
        ensureSongQueue(len, 12);
        chordIdxRef.current = shuffleQueueRef.current.shift();
        ensureSongQueue(len, 12);
      }
      setChordIndex(chordIdxRef.current);
      setSongNextDisplay(shuffleQueueRef.current[0]);
      setSongNext2(shuffleQueueRef.current[1]);
      setBeatCount(0); setCurrentStrum(-1);
    } else {
      chordIdxRef.current=0; shuffleQueueRef.current=[];
      setChordIndex(0); setBeatCount(0); setCurrentStrum(-1);
    }
    const ms=(60/bpmRef.current/2)*1000;
    intervalRef.current=setInterval(tick,ms); tick();
  },[tick]);

  const stopMetronome = useCallback(()=>{
    clearInterval(intervalRef.current); intervalRef.current=null;
    setCurrentStrum(-1); setChordIndex(0); setBeatCount(0);
    strumBeatRef.current=-1; chordIdxRef.current=0;
  },[]);

  useEffect(()=>{ if(isPlaying){stopMetronome();startMetronome();} },[bpm,beatsPerChord,hasSecondRow,row1Size,row2Size]);
  useEffect(()=>()=>{ clearInterval(intervalRef.current); clearInterval(countInIntervalRef.current); },[]);

  // Stop playback if the browser tab is hidden/backgrounded or a stop event fires.
  useEffect(()=>{
    const stop = ()=>{
      clearInterval(countInIntervalRef.current); setCountIn(0);
      stopMetronome(); setIsPlaying(false);
    };
    const onHide = ()=>{ if(document.hidden) stop(); };
    window.addEventListener("ntc-stop-playback", stop);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", stop);
    return ()=>{
      window.removeEventListener("ntc-stop-playback", stop);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", stop);
    };
  }, [stopMetronome]); // eslint-disable-line

  const doSave = () => {
    if(!saveName.trim()) return;
    const pattern = { id:Date.now(), name:saveName.trim(),
      strumActive, hasSecondRow, row1Size, row2Size,
      songChords, bpm, beatsPerChord, capo, random: songRandom,
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
      const encoded = encodeStrumDrill(p.name, p.strumActive, sizes, p.songChords, p.bpm, p.beatsPerChord, p.chordVariants||{}, p.capo||0, p.random);
      const url = `${window.location.origin}${window.location.pathname}?strumprog=${encoded}`;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(url)
          .then(()=>alert(`✅ Link copied!\n\nShare "${p.name}" with your members.`))
          .catch(()=>prompt("Copy this link:", url));
      } else { prompt("Copy this link:", url); }
    } catch(e) { alert("Couldn't generate link."); }
  };

  // Export current builder state as a strumprog payload (for the Package builder).
  // Per-slot voicings are baked into songChords, so we pass an EMPTY global
  // variant map. The app-wide chordVariants is shared across tabs and can hold
  // stale entries (e.g. Em→Em7); sending it would override the per-slot choices
  // when the package opens, which caused saved voicings to "revert".
  const exportPayload = () => {
    const sizes = hasSecondRow ? [row1Size||8, row2Size||8] : [row1Size||8];
    return encodeStrumDrill(loadedName||"Song", strumActive, sizes, songChords, bpm, beatsPerChord, {}, capo||0, songRandom);
  };

  const canPlay = songChords.length>=1;
  const nextChordIndex = songChords.length>0 ? (songRandom ? songNextDisplay : (chordIndex+1)%songChords.length) : 0;
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
    // In shuffle mode, settle the random starting chord + lookahead NOW (before the
    // count-in) so the carousel already shows the shuffled order during 3-2-1 and
    // doesn't jump when playback begins.
    if(songRandomRef.current && songChords.length>1){
      shuffleQueueRef.current = [];
      ensureSongQueue(songChords.length, 12);
      chordIdxRef.current = shuffleQueueRef.current.shift();
      ensureSongQueue(songChords.length, 12);
      setChordIndex(chordIdxRef.current);
      setSongNextDisplay(shuffleQueueRef.current[0]);
      setSongNext2(shuffleQueueRef.current[1]);
      setSongPrev(shuffleQueueRef.current[2] ?? chordIdxRef.current);
    }
    // Fixed 3 → 2 → 1 count-in (1s per beep), matching Chords & Strumming.
    let beat=3;
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
    }, 1000);
  };

  const cycleSize = cycleRowSize;
  const sizeLabel = rowSizeLabel;

  return (
    <>
      {onExport && (
        <div style={{ width:"100%", marginBottom:12 }}>
          <button onClick={()=>onExport("strumprog", exportPayload(), loadedName||(songChords.length?songChords.map(slotLabel).join(" "):"Song"))}
            disabled={songChords.length<1}
            style={{ width:"100%", padding:"12px", borderRadius:12,
              border:"1px solid rgba(255,190,11,0.5)",
              background: songChords.length<1 ? "#100d09" : "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.2) 0%, rgba(255,170,30,0) 70%), #16110a",
              color: songChords.length<1 ? "#3a3528" : "#FFD60A", fontSize:14, fontWeight:900,
              cursor: songChords.length<1 ? "not-allowed" : "pointer", fontFamily:"inherit" }}>
            ✓ Use this in package
          </button>
        </div>
      )}
      {/* ── SHARED LINK VIEW ─────────────────────────────── */}
      {!pickerOpen && (
        <>
          {/* Title */}
          {loadedName && !hideTitle && (
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
              afterChordIndex={songRandom ? songNext2 : null}
              prevChordIndex={songRandom ? songPrev : null}
              isPlaying={isPlaying} accentColor="#FFBE0B" isLastBeat={isLastBeat}
              bpm={bpm} beatsPerChord={beatsPerChord}
              songMode={true} slideSignal={slideSignal} slideDurMs={slideDurMs}
              chordVariants={chordVariants} updateVariant={updateVariant}
              perSlot={true} setCustomChords={setSongChords} />
          )}

          {/* Beat count dots */}
          {songChords.length>=1 && beatsPerChord>1 && (
            <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:16 }}>
              {Array(beatsPerChord).fill(null).map((_,i)=>(
                <div key={i} style={{ width:14, height:14, borderRadius:"50%",
                  background:isPlaying&&beatCount===i?"#FFBE0B":i===0?"#2a1f0a":"#16110a",
                  border:`1px solid ${i===0?"rgba(255,190,11,0.3)":"#241d10"}`,
                  boxShadow:isPlaying&&beatCount===i?"0 0 10px rgba(255,190,11,0.7)":"none",
                  transition:"background 0.05s" }} />
              ))}
            </div>
          )}

          {/* Strum pattern */}
          <div style={{ width:"100%", background:"#0c0a06", border:"1px solid #241d10",
            borderRadius:20, padding:"14px 10px", marginBottom:16,
            boxShadow:"inset 0 1px 0 rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize:9, color:"#6f6749", letterSpacing:2, textAlign:"center", marginBottom:12 }}>STRUMMING PATTERN</div>
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
          <div style={{ width:"100%", background:"#0c0a06", border:"1px solid #241d10",
            borderRadius:18, padding:"16px", marginBottom:14,
            boxShadow:"inset 0 1px 0 rgba(255,255,255,0.03)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:12, fontWeight:700, color:"#8a7f5e" }}>BPM</span>
              <span style={{ fontSize:14, fontWeight:900, color:"#FFBE0B" }}>{bpm}</span>
            </div>
            <input type="range" min={20} max={160} value={bpm}
              onChange={e=>setBpm(Number(e.target.value))}
              className="ntc-bpm-slider"
              style={{ width:"100%", cursor:"pointer", marginBottom:12 }} />
            <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:12 }}>
              {[40,60,80,100].map(b=>(
                <button key={b} onClick={()=>setBpm(b)} style={{
                  flex:1, padding:"8px 0", borderRadius:10,
                  border:bpm===b?"1px solid rgba(255,190,11,0.55)":"1px solid #241d10",
                  background:bpm===b?"radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.16) 0%, rgba(255,170,30,0) 65%), #16110a":"#100d09",
                  color:bpm===b?"#FFD60A":"#6f6749", fontSize:13, fontWeight:800, cursor:"pointer",
                  boxShadow:bpm===b?"0 0 14px rgba(255,160,20,0.15)":"none", transition:"all 0.2s" }}>{b}</button>
              ))}
            </div>
            <button onClick={handleTogglePlay} disabled={!canPlay&&countIn===0} style={{
              width:"100%", padding:"14px", borderRadius:14,
              border: !canPlay ? "1px solid #1c1710"
                : (isPlaying||countIn>0) ? "1px solid rgba(231,76,60,0.5)"
                : "1px solid rgba(255,190,11,0.5)",
              background: !canPlay ? "#100d09"
                : (isPlaying||countIn>0) ? "radial-gradient(120% 160% at 50% 0%, rgba(231,76,60,0.18) 0%, rgba(231,76,60,0) 70%), #1a0f0c"
                : "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.2) 0%, rgba(255,170,30,0) 70%), #16110a",
              color: !canPlay?"#3a3528": (isPlaying||countIn>0) ? "#ff8a7a" : "#FFD60A",
              fontSize:16, fontWeight:900, letterSpacing:0.5,
              cursor:canPlay||countIn>0?"pointer":"not-allowed",
              boxShadow: !canPlay?"none": (isPlaying||countIn>0) ? "0 0 22px rgba(231,76,60,0.2)" : "0 0 22px rgba(255,160,20,0.22)",
              fontFamily:"inherit", transition:"all 0.2s",
            }}>
              {!canPlay?"Select a chord to start":countIn>0?<><span style={{fontSize:22,fontWeight:900}}>{countIn}</span><span style={{fontSize:11,fontWeight:700,opacity:0.7,marginLeft:8}}>tap to skip</span></>:isPlaying?"⏹ Stop":"▶ Play"}
            </button>
          </div>

          {/* Save / Load — hidden in shared link view */}
          {!sharedView && (<>
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
                      setSongRandom(!!p.random); songRandomRef.current=!!p.random;
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
          </>)}
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
                afterChordIndex={songRandom ? songNext2 : null}
                prevChordIndex={songRandom ? songPrev : null}
                isPlaying={isPlaying} accentColor="#FFBE0B" isLastBeat={isLastBeat}
                bpm={bpm} beatsPerChord={beatsPerChord}
                chordVariants={chordVariants} updateVariant={updateVariant}
                perSlot={true} setCustomChords={setSongChords} />
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
              {songChords.length>1 && (
                <button onClick={()=>{ 
                    const nv=!songRandom; setSongRandom(nv); songRandomRef.current=nv;
                    shuffleQueueRef.current=[];
                    if(nv && songChords.length>1 && !isPlaying){
                      // Settle a random starting chord + lookahead now, so the carousel
                      // already shows a shuffled order before Start (no jump after countdown).
                      ensureSongQueue(songChords.length, 12);
                      const first = shuffleQueueRef.current.shift();
                      chordIdxRef.current = first; setChordIndex(first);
                      ensureSongQueue(songChords.length, 12);
                      setSongNextDisplay(shuffleQueueRef.current[0]);
                      setSongNext2(shuffleQueueRef.current[1]);
                      setSongPrev(shuffleQueueRef.current[2] ?? first);
                    }
                  }}
                  title="Shuffle the chord order each loop (keeps your strum pattern)"
                  style={{ display:"flex", alignItems:"center", gap:6,
                    borderRadius:10, padding:"6px 12px", cursor:"pointer",
                    border: songRandom ? "1px solid #FFBE0B" : "1px solid #2a2a2a",
                    background: songRandom ? "rgba(255,190,11,0.12)" : "#111",
                    color: songRandom ? "#FFBE0B" : "#666", fontSize:12, fontWeight:700,
                    boxShadow: songRandom ? "0 0 10px rgba(255,190,11,0.25)" : "none" }}>
                  🎲 Shuffle chords
                </button>
              )}
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
function AdvancedBuildSong({ audio, chordVariants, updateVariant, sharedView=false, initialParam=null, onExport=null, hideTitle=false }) {
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
    if(!muteRef.current && next%2===0) playChordClick(next===0);
    const isDown=next%2===0;
    if(strumRef.current[flatIdx] && currentChordRef.current) playChordStrum(getAudioKey(currentChordRef.current, chordVariants), isDown, capoRef.current);
  },[playChordClick,playChordStrum]);

  const startMetronome = useCallback(()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    strumBeatRef.current=-1; currentChordRef.current=null;
    // Don't reset currentChordLabel here to avoid layout jump
    const ms=(60/bpmRef.current/2)*1000;
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

  // Export current builder state as a pattern payload (for the Package builder).
  const exportPayload = () => {
    const sparse = {
      n: loadedPatternName||"Song",
      rs: rowSizes,
      rr: rowRepeats||rowSizes.map(()=>1),
      sa: strumActive.reduce((acc,v,i)=>{ if(v) acc.push(i); return acc; }, []),
      bc: Object.fromEntries(blockChords.map((v,i)=>[i,v]).filter(([,v])=>v)),
      b: bpm,
      c: capo||0,
    };
    return btoa(JSON.stringify(sparse));
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
      const params = new URLSearchParams(initialParam!=null ? "" : window.location.search);
      const encoded = initialParam!=null ? initialParam : params.get("pattern");
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
      setBuilderOpen(onExport ? true : false);
      if(initialParam==null){ window.scrollTo(0, 0); }
      // Keep the share param in the URL so a refresh reloads this, not the home page.
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
      // Fixed 3 → 2 → 1 count-in (1s per beep), matching Chords & Strumming.
      let beat = 3, beatIdx = 0;
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
      }, 1000);
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
      {onExport && (
        <div style={{ width:"100%", marginBottom:12 }}>
          <button onClick={()=>onExport("pattern", exportPayload(), loadedPatternName||"Advanced song")}
            disabled={!hasAnyChords}
            style={{ width:"100%", padding:"12px", borderRadius:12,
              border:"1px solid rgba(255,190,11,0.5)",
              background: !hasAnyChords ? "#100d09" : "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.2) 0%, rgba(255,170,30,0) 70%), #16110a",
              color: !hasAnyChords ? "#3a3528" : "#FFD60A", fontSize:14, fontWeight:900,
              cursor: !hasAnyChords ? "not-allowed" : "pointer", fontFamily:"inherit" }}>
            ✓ Use this in package
          </button>
        </div>
      )}
      {/* ── VIEW MODE (shared link) ──────────────────────────── */}
      {!builderOpen && (
        <>
          {/* Title */}
          {loadedPatternName && !hideTitle && (
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

function SectionHeader({ title, sub, action=null }) {
  return (
    <div style={{
      borderRadius:18, padding:"18px 24px",
      textAlign:"center", marginBottom:18, width:"100%", position:"relative",
      background:"#0e0b07", border:"1px solid #211b10",
      boxShadow:"0 6px 22px rgba(0,0,0,0.4)",
    }}>
      {action && <div style={{ position:"absolute", top:12, right:12 }}>{action}</div>}
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
                  // Straight to the voicings for the new slot, basic pre-selected.
                  if(HAS_VARIATIONS.has(chord)) setVariantPickerChord({ idx: customChords.length, base: chord, current: chord });
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
                        role="button" aria-label={`${chord} voicings`}
                        style={{ position:"absolute", top:2, right:2, width:30, height:30,
                          borderRadius:"50%", background:"rgba(10,8,4,0.88)",
                          border:"1.5px solid rgba(255,190,11,0.75)",
                          boxShadow:"0 0 8px rgba(255,170,20,0.35)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:15, color:"#FFBE0B",
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
                    aria-label={`${slotLabel(c)} voicings`}
                    style={{ minWidth:30, height:26, borderRadius:8, padding:"0 6px",
                      border:`1px solid ${isVar?"rgba(255,190,11,0.65)":"rgba(255,190,11,0.35)"}`,
                      background:isVar?"rgba(255,190,11,0.15)":"rgba(10,8,4,0.6)",
                      color:isVar?"#FFD60A":"#c9a03a", fontSize:13, cursor:"pointer",
                      lineHeight:1, fontFamily:"inherit" }}>⚙</button>
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
        <FixedLayer>
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
            if(HAS_VARIATIONS.has(outsideKeyChord)) setVariantPickerChord({ idx: customChords.length, base: outsideKeyChord, current: outsideKeyChord });
          }}
          onCancel={()=>setOutsideKeyChord(null)}
        />
        </FixedLayer>
      )}
      {variantPickerChord && (
        <FixedLayer>
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
        </FixedLayer>
      )}
    </div>
  );
}

function ChordGrid({ chords, chordIndex, nextChordIndex, afterChordIndex=null, prevChordIndex=null, isPlaying, accentColor, isLastBeat, bpm, beatsPerChord, countdown=0, songMode=false, slideSignal=0, slideDurMs=380, chordVariants, updateVariant, perSlot=false, setCustomChords, chordIndexVal }) {
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
  const afterIdx = (typeof afterChordIndex === "number" ? afterChordIndex : (nextIdx+1)%n);
  const prevIdx = (typeof prevChordIndex === "number" ? prevChordIndex : (chordIndex-1+n)%n);
  const windowIdx = n > 0
    ? [ prevIdx%n, chordIndex%n, nextIdx%n, afterIdx%n ]
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

  // Playing (normal mode): continuous dwell→travel glide via rAF.
  useEffect(() => {
    if (songMode || !isPlaying || n === 0) return;
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
  }, [songMode, isPlaying, bpm, beatsPerChord, chordIndex, n]); // eslint-disable-line

  // Song mode: hold the chord static, centered. When the chord advances, the
  // slide (if any) is done — snap authoritatively to the new centered chord so
  // the strip never ends up parked on slot 2 (which would show the chord AFTER).
  const slidingRef = useRef(false);
  useEffect(() => {
    if (!songMode) return;
    slidingRef.current = false;        // chord changed → slide is over
    cancelAnimationFrame(rafRef.current);
    paint(centerForSlot(CUR_SLOT));    // recenter the (new) current chord
  }, [songMode, chordIndex, n]); // eslint-disable-line

  // Also park on play/stop in song mode.
  useEffect(() => {
    if (!songMode || slidingRef.current) return;
    cancelAnimationFrame(rafRef.current);
    paint(centerForSlot(CUR_SLOT));
  }, [songMode, isPlaying]); // eslint-disable-line

  // Song mode one-shot slide: when slideSignal increments, glide current→next
  // over slideDurMs, landing as the chord switches.
  const slideSigRef = useRef(slideSignal);
  useEffect(() => {
    if (!songMode || slideSignal === slideSigRef.current) { slideSigRef.current = slideSignal; return; }
    slideSigRef.current = slideSignal;
    if (n === 0) return;
    cancelAnimationFrame(rafRef.current);
    const from = centerForSlot(CUR_SLOT);
    const to = centerForSlot(CUR_SLOT + 1);
    const dur = Math.max(120, slideDurMs);
    const t0 = performance.now();
    slidingRef.current = true;
    const ease = (x) => x<0.5 ? 4*x*x*x : 1-Math.pow(-2*x+2,3)/2; // easeInOutCubic
    const run = (now) => {
      let p = (now - t0) / dur;
      if (p > 1) p = 1;
      paint(from + (to - from) * ease(p));
      if (p < 1) { rafRef.current = requestAnimationFrame(run); }
      else { slidingRef.current = false; }
    };
    rafRef.current = requestAnimationFrame(run);
  }, [slideSignal]); // eslint-disable-line

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

      {variantPickerSlot && (
        <FixedLayer>
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
        </FixedLayer>
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
      <style>{NTC_SLIDER_CSS}</style>
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

// ── Persistent one-way flags (cloud-synced, never un-set) ──
function readFlag(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw && JSON.parse(raw).unlocked) return true;
  } catch (_) {}
  return false;
}
function persistFlag(key) {
  try {
    localStorage.setItem(key, JSON.stringify({ unlocked: true, at: new Date().toISOString() }));
  } catch (_) {}
}
// Build unlock — earned by completing the 30-Day Challenge. Separate from the
// tracker data, so resetting the 30 days later never re-locks Build.
function readBuildUnlocked()    { return readFlag(BUILD_UNLOCK_KEY); }
function persistBuildUnlocked() { persistFlag(BUILD_UNLOCK_KEY); }
// Trophy modal shown once, ever — not on every login while the grid is full.
function readCelebrated()       { return readFlag(CELEBRATED_KEY); }
function persistCelebrated()    { persistFlag(CELEBRATED_KEY); }

function readCustomTrackerName() {
  try {
    const raw = localStorage.getItem(CUSTOM_TRACKER_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && !saved.deleted && saved.config && saved.config.name) return saved.config.name;
  } catch (_) {}
  return null;
}

// ── FixedLayer ── renders overlays (modals, confetti canvas) into
// document.body via a portal. Required because the app's tab-fade wrapper
// animates with a CSS transform, and a transformed ancestor becomes the
// containing block for position:fixed children — so without the portal,
// "fixed" overlays center on the tall tracker column instead of the screen.
function FixedLayer({ children }) {
  if (typeof document === "undefined") return children;
  return createPortal(
    <div style={{ fontFamily:"'Trebuchet MS', sans-serif" }}>{children}</div>,
    document.body
  );
}

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
  function launch(themeColors) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    const colors = (themeColors && themeColors.length)
      ? themeColors
      : ["#FFD60A", "#F77F00", "#ffffff", "#FFBE0B", "#FFE27A"];
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

function TrackerTab({ context = "app", hideGenerate = false }) {
  const [data, setData] = useState(trackerInit);
  const [loaded, setLoaded] = useState(false);
  const [celebrating, setCelebrating] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const celebratedRef = useRef(false);   // ensures the celebration fires only once
  const celebrateTimerRef = useRef(null); // pending delayed-celebration timer
  const { canvasRef, launch } = useTrackerConfetti();

  // ── Build (custom tracker) unlock ──
  // "challenge" | "build". Build is usable only in the main app (sandbox);
  // package links show the teaser and route members to the full app.
  const [mode, setMode] = useState("challenge");
  const [buildUnlocked, setBuildUnlocked] = useState(readBuildUnlocked);
  const [justUnlocked, setJustUnlocked] = useState(false);   // drives the unlock animation
  const [showLockedInfo, setShowLockedInfo] = useState(false);  // low-opacity teaser bubble
  const [showOpenAppInfo, setShowOpenAppInfo] = useState(false); // package view → full app

  // Build pill label follows the custom tracker's name once one exists;
  // falls back to "My Tracker" when the name won't fit the bubble.
  const [customName, setCustomName] = useState(readCustomTrackerName);
  useEffect(() => {
    const refresh = () => setCustomName(readCustomTrackerName());
    window.addEventListener("ntc-custom-tracker-changed", refresh);
    return () => window.removeEventListener("ntc-custom-tracker-changed", refresh);
  }, []);
  const buildPillText = !buildUnlocked || !customName
    ? "Build"
    : (customName.length <= 14 ? customName : "My Tracker");

  const handleBuildClick = () => {
    if (context === "package") {
      // Package links have no Build view — teaser when locked, pointer to the
      // full app when unlocked.
      if (!buildUnlocked) setShowLockedInfo(true); else setShowOpenAppInfo(true);
      return;
    }
    // In the app, Build is always viewable: unlocked members get their tracker,
    // locked members get the greyed preview with the unlock message.
    setMode("build");
  };

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

  // 30-day completion. Build unlocks whenever the grid is complete; the trophy
  // modal fires ONCE EVER (persisted + cloud-synced flag), 2.5s after the
  // challenge is first completed — never again on later logins, which would
  // get annoying fast.
  useEffect(() => {
    if (!loaded || celebratedRef.current) return;
    const allDaysActive = data.every(day => TRACKER_TASKS.some(t => day[t.id]));
    if (allDaysActive) {
      // Unlock Build immediately (pill flips even if the modal never re-shows).
      const firstUnlock = !readBuildUnlocked();
      if (firstUnlock) persistBuildUnlocked();
      setBuildUnlocked(true);
      // Already congratulated on some visit/device — stay quiet.
      if (readCelebrated()) { celebratedRef.current = true; return; }
      if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current);
      celebrateTimerRef.current = setTimeout(() => {
        celebratedRef.current = true;
        persistCelebrated();
        if (firstUnlock) setJustUnlocked(true);
        setShowModal(true);
        launch();
      }, 2500);
    } else if (celebrateTimerRef.current) {
      // They dropped back below complete during the delay — cancel.
      clearTimeout(celebrateTimerRef.current);
      celebrateTimerRef.current = null;
    }
  }, [data, loaded]); // eslint-disable-line
  useEffect(() => () => { if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current); }, []);

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
      <FixedLayer>
        <canvas ref={canvasRef} style={{ position:"fixed", top:0, left:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:9999 }} />
      </FixedLayer>

      {/* ── Mode switcher: 30-Day Challenge / Build (locked until day 30) ── */}
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        {[
          { id:"challenge", label:<>🔥 30-Day Challenge</>, onClick:()=>setMode("challenge"), on: mode==="challenge" },
          { id:"build",
            label: buildUnlocked ? <>🛠️ {buildPillText}</> : (
              <>
                <span style={{ opacity:0.4, marginRight:6 }}>🛠️</span>
                <span style={{ opacity:0.75 }}>Build</span>
                {/* Lock badge pinned to the pill's top-right corner */}
                <span style={{ position:"absolute", top:3, right:7, fontSize:13,
                  filter:"drop-shadow(0 1px 3px rgba(0,0,0,0.9))" }}>🔒</span>
              </>
            ),
            onClick: handleBuildClick, on: mode==="build" },
        ].map(p => (
          <button key={p.id} onClick={p.onClick} style={{
            position:"relative", flex:1, padding:"11px 8px", borderRadius:13, fontFamily:"inherit", cursor:"pointer",
            border:`1px solid ${p.on ? "rgba(255,190,11,0.55)" : "#241d10"}`,
            background: p.on
              ? "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.16) 0%, rgba(255,170,30,0) 65%), #16110a"
              : "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.05) 0%, rgba(255,170,30,0) 60%), #100d09",
            color: p.on ? "#FFD60A" : (p.id==="build" && !buildUnlocked ? "#6f6749" : "#8a7f5e"),
            fontSize:13, fontWeight:800, letterSpacing:0.3, whiteSpace:"nowrap",
            boxShadow: p.on ? "0 0 18px rgba(255,160,20,0.16)" : "none",
            transition:"all 0.22s ease" }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Locked teaser — low-opacity bubble explaining how Build is earned.
          Portaled so it centers on the SCREEN, not the tall tracker column. */}
      {showLockedInfo && (
        <FixedLayer>
        <div onClick={()=>setShowLockedInfo(false)} style={{ position:"fixed", inset:0, zIndex:1000,
          background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center",
          padding:24, animation:"ntcModalFade 0.3s ease both" }}>
          <style>{`@keyframes ntcModalFade { from { opacity:0; } to { opacity:1; } }`}</style>
          <div onClick={e=>e.stopPropagation()} style={{ opacity:0.93, background:"rgba(17,15,10,0.92)",
            backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)",
            border:"1px solid rgba(255,190,11,0.28)", borderRadius:20, padding:"32px 24px",
            maxWidth:380, width:"100%", textAlign:"center" }}>
            <div style={{ position:"relative", display:"inline-block", fontSize:44, marginBottom:12 }}>
              <span style={{ opacity:0.4 }}>🛠️</span>
              <span style={{ position:"absolute", right:-16, bottom:-6, fontSize:"0.95em",
                filter:"drop-shadow(0 2px 5px rgba(0,0,0,0.9))" }}>🔒</span>
            </div>
            <div style={{ fontSize:20, fontWeight:900, color:"#f3ead2", marginBottom:10, letterSpacing:0.3 }}>
              Build is locked — for now
            </div>
            <p style={{ fontSize:13.5, color:"#9a8f6e", lineHeight:1.7, marginBottom:14 }}>
              Finish your <strong style={{ color:"#FFBE0B" }}>30-Day Challenge</strong> to unlock the
              Build feature — create your own tracker with a custom number of days, your own
              practice categories, and custom exercises you design yourself.
            </p>
            <div style={{ fontSize:12.5, color:"#FFBE0B", fontWeight:700, background:"rgba(255,190,11,0.08)",
              border:"1px solid rgba(255,190,11,0.22)", borderRadius:12, padding:"10px 12px", marginBottom:20 }}>
              You're {totalDaysActive} of 30 days in — keep going 🔥
            </div>
            <button onClick={()=>setShowLockedInfo(false)} style={{ ...GLOW_BTN,
              borderRadius:12, padding:"13px 28px", fontSize:14, width:"100%" }}>
              Back to the challenge
            </button>
          </div>
        </div>
        </FixedLayer>
      )}

      {/* Package view: Build lives in the full app */}
      {showOpenAppInfo && (
        <FixedLayer>
        <div onClick={()=>setShowOpenAppInfo(false)} style={{ position:"fixed", inset:0, zIndex:1000,
          background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center",
          padding:24, animation:"ntcModalFade 0.3s ease both" }}>
          <style>{`@keyframes ntcModalFade { from { opacity:0; } to { opacity:1; } }`}</style>
          <div onClick={e=>e.stopPropagation()} style={{ opacity:0.95, background:"rgba(17,15,10,0.94)",
            border:"1px solid rgba(255,190,11,0.28)", borderRadius:20, padding:"32px 24px",
            maxWidth:380, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:44, marginBottom:10 }}>🛠️</div>
            <div style={{ fontSize:20, fontWeight:900, color:"#f3ead2", marginBottom:10 }}>
              Build is unlocked!
            </div>
            <p style={{ fontSize:13.5, color:"#9a8f6e", lineHeight:1.7, marginBottom:20 }}>
              Your custom tracker lives in the full practice app, so it's always in one
              place no matter which practice link you open.
            </p>
            <button onClick={()=>{ window.location.href = window.location.origin + window.location.pathname; }}
              style={{ ...GLOW_BTN, borderRadius:12, padding:"13px 28px", fontSize:14,
              width:"100%", marginBottom:10 }}>
              Open the practice app →
            </button>
            <button onClick={()=>setShowOpenAppInfo(false)} style={{ background:"transparent",
              border:"1px solid #241d10", borderRadius:12, padding:"11px 28px", fontSize:13, fontWeight:700,
              color:"#8a7f5e", cursor:"pointer", width:"100%", fontFamily:"inherit" }}>
              Stay here
            </button>
          </div>
        </div>
        </FixedLayer>
      )}

      {/* Completion modal — portaled for true viewport centering */}
      {showModal && (
        <FixedLayer>
        <div onClick={()=>setShowModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)",
          zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24,
          animation:"ntcModalFade 0.4s ease both" }}>
          <style>{`@keyframes ntcModalFade { from { opacity:0; } to { opacity:1; } }`}</style>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#111", border:"1px solid #2a2a2a",
            borderRadius:24, padding:"40px 28px", maxWidth:420, width:"100%", textAlign:"center", position:"relative" }}>
            <div style={{ position:"absolute", top:0, left:0, right:0, height:3,
              background:"linear-gradient(90deg,#FFD60A,#F77F00)", borderRadius:"24px 24px 0 0" }} />
            <span style={{ fontSize:64, marginBottom:8, display:"block" }}>🏆</span>
            <div style={{ fontSize:46, fontWeight:900, lineHeight:1, marginBottom:14,
              background:"linear-gradient(135deg,#FFD60A,#F77F00)", WebkitBackgroundClip:"text",
              backgroundClip:"text", WebkitTextFillColor:"transparent" }}>
              {overallPct}%
            </div>
            <div style={{ fontSize:30, fontWeight:900, marginBottom:8, letterSpacing:0.5,
              background:"linear-gradient(135deg,#FFD60A,#F77F00)", WebkitBackgroundClip:"text",
              backgroundClip:"text", WebkitTextFillColor:"transparent", lineHeight:1.1 }}>
              YOU'RE AN OFFICIAL GUITAR PLAYER
            </div>
            <div style={{ fontSize:16, color:"#fff", fontWeight:700, marginBottom:16 }}>30 Days. Done. No excuses.</div>
            <p style={{ fontSize:14, color:"#999", lineHeight:1.7, marginBottom:16 }}>
              You showed up <strong style={{color:"#ccc"}}>every single day</strong> for 30 days straight.
              That's not a beginner anymore — that's a guitar player. Keep going. 🔥
            </p>
            {/* Build unlock — animates in the first time the challenge is completed */}
            {justUnlocked && (
              <div style={{ marginBottom:16 }}>
                <style>{`
                  @keyframes ntcUnlockPop { 0% { transform:scale(0); opacity:0; } 60% { transform:scale(1.12); }
                    80% { transform:scale(0.97); } 100% { transform:scale(1); opacity:1; } }
                  @keyframes ntcLockShake { 0%,100% { transform:rotate(0); } 15% { transform:rotate(-14deg); }
                    30% { transform:rotate(12deg); } 45% { transform:rotate(-8deg); } 60% { transform:rotate(6deg); }
                    75% { transform:rotate(-3deg); } }
                  @keyframes ntcUnlockGlow { 0%,100% { box-shadow:0 0 12px rgba(255,190,11,0.22); }
                    50% { box-shadow:0 0 28px rgba(255,190,11,0.5); } }
                  @keyframes ntcUnlockShine { from { transform:translateX(-100%); } to { transform:translateX(100%); } }
                `}</style>
                <div style={{ position:"relative", overflow:"hidden", borderRadius:16,
                  border:"1px solid rgba(255,190,11,0.5)", padding:"18px 14px 16px",
                  background:"radial-gradient(130% 130% at 50% 0%, rgba(255,190,11,0.14) 0%, rgba(255,140,0,0.05) 55%, transparent 100%), #14100a",
                  animation:"ntcUnlockPop 0.7s cubic-bezier(0.2,1.4,0.4,1) 0.5s both, ntcUnlockGlow 2.4s ease 1.4s infinite" }}>
                  <div style={{ position:"absolute", inset:0, pointerEvents:"none",
                    background:"linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.14) 50%, transparent 60%)",
                    transform:"translateX(-100%)", animation:"ntcUnlockShine 1.1s ease 1.5s both" }} />
                  <div style={{ fontSize:34, display:"inline-block", animation:"ntcLockShake 0.9s ease 1.3s both" }}>🔓</div>
                  <div style={{ fontSize:10.5, letterSpacing:2.5, color:"#c9a03a", fontWeight:800,
                    textTransform:"uppercase", marginTop:6 }}>New feature unlocked</div>
                  <div style={{ fontSize:24, fontWeight:900, marginTop:4, letterSpacing:0.4,
                    background:"linear-gradient(135deg,#FFD60A,#F77F00)", WebkitBackgroundClip:"text",
                    backgroundClip:"text", WebkitTextFillColor:"transparent" }}>🛠️ Build</div>
                  <div style={{ fontSize:12.5, color:"#9a8f6e", lineHeight:1.6, marginTop:6 }}>
                    Create your own tracker — custom days, your own practice categories,
                    and custom exercises you design yourself.
                  </div>
                  <button onClick={()=>{ setShowModal(false);
                      if (context === "app") setMode("build"); else setShowOpenAppInfo(true); }}
                    style={{ ...GLOW_BTN, marginTop:12, borderRadius:11, padding:"10px 22px", fontSize:13 }}>
                    Try Build →
                  </button>
                </div>
              </div>
            )}

            <div style={{ fontSize:13, color:"#FFD60A", fontWeight:700, lineHeight:1.6, marginBottom:24,
              background:"rgba(255,190,11,0.08)", border:"1px solid rgba(255,190,11,0.25)",
              borderRadius:12, padding:"12px 14px" }}>
              📸 Screenshot this and share it in the Guitar Wins post — let the club celebrate with you!
            </div>
            <button onClick={()=>setShowModal(false)} style={{ ...GLOW_BTN,
              borderRadius:12, padding:"14px 32px", fontSize:15, width:"100%" }}>
              Let's keep going! 🤩
            </button>
          </div>
        </div>
        </FixedLayer>
      )}

      {/* ── Challenge content (kept mounted via display toggle so its state,
          timers and autosave keep working while Build is open) ── */}
      <div style={{ display: mode === "challenge" ? "block" : "none" }}>

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

      {/* Reset */}
      <div style={{ display:"flex", justifyContent:"center", marginTop:22 }}>
        <button onClick={resetAll} style={{ background:"transparent", border:"1px solid #241d10", color:"#6f6749",
          fontSize:11, fontFamily:"inherit", padding:"8px 16px", borderRadius:10, cursor:"pointer", letterSpacing:1 }}>
          Reset all 30 days
        </button>
      </div>

      </div>{/* end challenge content */}

      {/* ── Build: custom tracker (sandbox / main app only). Locked members can
          look around — everything greyed out behind the unlock message — and see
          the Exercise Generator button waiting for them. ── */}
      {mode === "build" && context === "app" && (
        buildUnlocked
          ? <CustomTrackerSection hideGenerate={hideGenerate} />
          : <LockedBuildPreview totalDaysActive={totalDaysActive} />
      )}

      <div style={{ textAlign:"center", paddingTop:28, color:"#332e22", fontSize:11 }}>
        © {new Date().getFullYear()} No Theory Club · All rights reserved.
      </div>
    </div>
  );
}

// ─── BUILD (custom tracker) ──────────────────────────────────────────────────
// Unlocked by completing the 30-Day Challenge. Members design their own
// tracker: number of days (7–90), a personal goal name, an optional target,
// and up to 4 custom practice categories. Stored under CUSTOM_TRACKER_KEY as
// { config, data, updatedAt } and cloud-synced like the 30-day tracker.

const BUILD_ICONS = ["🎸","🤚","🎵","🥁","🎤","🎧","📖","✍️","⏱️","💪","🎯","🧠"];
const BUILD_MAX_TASKS = 4;
const BUILD_MIN_DAYS = 7;
const BUILD_MAX_DAYS = 90;

// On-brand warm-glow button: dark body, gold text, radial glow — the same
// treatment as the active tab pills. Callers add size/shape (padding, radius…).
const GLOW_BTN = {
  border:"1px solid rgba(255,190,11,0.55)",
  background:"radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.18) 0%, rgba(255,170,30,0) 65%), #16110a",
  color:"#FFD60A", fontWeight:900, cursor:"pointer", fontFamily:"inherit",
  boxShadow:"0 0 22px rgba(255,160,20,0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
};

// Color themes for custom trackers. Two-stop gradients tuned for the dark
// warm background; every accent in the tracker derives from these two hexes.
const BUILD_THEMES = {
  ember:       { name:"Ember",       a:"#FFD60A", b:"#F77F00" }, // house gold
  aurora:      { name:"Aurora",      a:"#6EF3C5", b:"#19B8FF" },
  ultraviolet: { name:"Ultraviolet", a:"#C9A7FF", b:"#7C4DFF" },
  neonrose:    { name:"Neon Rose",   a:"#FF9BB3", b:"#FF2E63" },
  glacier:     { name:"Glacier",     a:"#CFF6FF", b:"#38BDF8" },
  venom:       { name:"Venom",       a:"#D9FF3D", b:"#34D399" },
};
const DEFAULT_THEME = "ember";
function buildTheme(config) {
  return BUILD_THEMES[config && config.theme] || BUILD_THEMES[DEFAULT_THEME];
}
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Generalised streak: same rules as the 30-day tracker, any length / any tasks.
function customStreak(data, tasks) {
  if (!Array.isArray(data) || !data.length) return 0;
  let lastActive = -1;
  for (let i = data.length - 1; i >= 0; i--) {
    if (tasks.some(t => data[i][t.id])) { lastActive = i; break; }
  }
  if (lastActive === -1) return 0;
  let streak = 0;
  for (let i = lastActive; i >= 0; i--) {
    if (tasks.some(t => data[i][t.id])) streak++;
    else break;
  }
  return streak;
}

function CustomTrackerSection({ hideGenerate = false }) {
  const [saved, setSaved] = useState(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_TRACKER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  });
  const [editing, setEditing] = useState(false);

  const active = saved && !saved.deleted && saved.config ? saved : null;

  const persist = (next) => {
    const withTs = { ...next, updatedAt: new Date().toISOString() };
    try { localStorage.setItem(CUSTOM_TRACKER_KEY, JSON.stringify(withTs)); } catch (_) {}
    setSaved(withTs);
    try { window.dispatchEvent(new Event("ntc-custom-tracker-changed")); } catch (_) {}
  };
  if (!active || editing) {
    return (
      <div>
        {/* No tracker yet — the generator button leads while they set one up. */}
        {!hideGenerate && <GenerateLauncherButton />}
        <BuildSetup
          existing={editing ? active : null}
          onSave={(next) => { persist(next); setEditing(false); }}
          onCancel={active ? () => setEditing(false) : null}
        />
      </div>
    );
  }
  return (
    <CustomTracker
      saved={active}
      onChange={persist}
      onEdit={() => setEditing(true)}
      hideGenerate={hideGenerate}
    />
  );
}

// ── Locked Build preview — shown when a member opens Build before finishing
// the 30-Day Challenge. The whole feature is visible (setup form, themes, the
// Exercise Generator button) but greyed out and inert behind the message. ──
function LockedBuildPreview({ totalDaysActive }) {
  return (
    <div>
      <div style={{ border:"1px solid rgba(255,190,11,0.35)", borderRadius:16, padding:"18px 16px",
        marginBottom:18, textAlign:"center",
        background:"radial-gradient(130% 130% at 50% 0%, rgba(255,190,11,0.1) 0%, transparent 60%), #14100a" }}>
        <div style={{ position:"relative", display:"inline-block", fontSize:32, marginBottom:8 }}>
          <span style={{ opacity:0.4 }}>🛠️</span>
          <span style={{ position:"absolute", right:-12, bottom:-4, fontSize:"0.95em",
            filter:"drop-shadow(0 2px 5px rgba(0,0,0,0.9))" }}>🔒</span>
        </div>
        <div style={{ fontSize:16, fontWeight:900, color:"#f3ead2", marginBottom:6 }}>
          This is what's waiting for you
        </div>
        <div style={{ fontSize:12.5, color:"#9a8f6e", lineHeight:1.7 }}>
          Finish your <strong style={{ color:"#FFBE0B" }}>30-Day Challenge</strong> to unlock
          custom trackers and the Exercise Generator. You're{" "}
          <strong style={{ color:"#FFBE0B" }}>{totalDaysActive} of 30</strong> days in — keep going 🔥
        </div>
      </div>
      {/* Inert preview: visible, not clickable */}
      <div aria-hidden="true" style={{ pointerEvents:"none", opacity:0.4, filter:"grayscale(0.35)",
        userSelect:"none" }}>
        <GenerateLauncherButton />
        <BuildSetup existing={null} onSave={()=>{}} onCancel={null} />
      </div>
    </div>
  );
}

// ── Setup / edit form ──
function BuildSetup({ existing, onSave, onCancel }) {
  const cfg = existing && existing.config;
  const [name, setName] = useState((cfg && cfg.name) || "");
  const [days, setDays] = useState((cfg && cfg.days) || 30);
  const [target, setTarget] = useState((cfg && cfg.target) || "");
  const [theme, setTheme] = useState((cfg && cfg.theme) || DEFAULT_THEME);
  const [tasks, setTasks] = useState(() =>
    cfg && Array.isArray(cfg.tasks) && cfg.tasks.length
      ? cfg.tasks.map(t => ({ ...t }))
      : [
          { id: "b1", label: "Chord Switching", icon: "🎸" },
          { id: "b2", label: "Strumming",       icon: "🥁" },
          { id: "b3", label: "Song Practice",   icon: "🎵" },
        ]
  );

  const clampDays = (n) => Math.max(BUILD_MIN_DAYS, Math.min(BUILD_MAX_DAYS, Math.round(Number(n) || BUILD_MIN_DAYS)));
  const cycleIcon = (idx) => setTasks(prev => prev.map((t, i) => {
    if (i !== idx) return t;
    const at = BUILD_ICONS.indexOf(t.icon);
    return { ...t, icon: BUILD_ICONS[(at + 1) % BUILD_ICONS.length] };
  }));
  const setLabel = (idx, v) => setTasks(prev => prev.map((t, i) => i === idx ? { ...t, label: v } : t));
  const removeTask = (idx) => setTasks(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  const addTask = () => setTasks(prev => prev.length >= BUILD_MAX_TASKS ? prev
    : [...prev, { id: "b" + Math.random().toString(36).slice(2, 8), label: "", icon: BUILD_ICONS[prev.length % BUILD_ICONS.length] }]);

  const save = () => {
    const cleanTasks = tasks.map(t => ({ ...t, label: t.label.trim() })).filter(t => t.label);
    if (!cleanTasks.length) { alert("Add at least one practice category."); return; }
    const d = clampDays(days);
    const config = { name: name.trim() || "My Challenge", days: d, target: target.trim(), theme, tasks: cleanTasks };
    // Preserve any existing ticks: same task ids keep their checks day-for-day;
    // extra days start empty; removed days are dropped.
    const data = Array.from({ length: d }, (_, i) => {
      const prev = (existing && existing.data && existing.data[i]) || {};
      return Object.fromEntries(cleanTasks.map(t => [t.id, Boolean(prev[t.id])]));
    });
    onSave({ config, data });
  };

  const fieldLabel = { fontSize:10, textTransform:"uppercase", letterSpacing:1.5, color:"#7a6a3a",
    fontWeight:700, marginBottom:7 };
  const inputStyle = { width:"100%", boxSizing:"border-box", background:"#0e0b06", border:"1px solid #241d10",
    borderRadius:12, padding:"12px 14px", fontSize:14, color:"#f3ead2", fontFamily:"inherit", outline:"none" };

  return (
    <div>
      <div style={{ textAlign:"center", marginBottom:22 }}>
        <div style={{ fontSize:11, letterSpacing:3, color:"#7a6a3a", fontWeight:700, textTransform:"uppercase" }}>
          🛠️ Build
        </div>
        <div style={{ fontSize:24, fontWeight:900, marginTop:8, color:"#f3ead2", letterSpacing:0.3 }}>
          Your challenge. <span style={{ background:"linear-gradient(135deg,#FFD60A,#F77F00)",
            WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent" }}>Your rules.</span>
        </div>
        <div style={{ fontSize:12.5, color:"#776b4d", marginTop:8, lineHeight:1.6 }}>
          You earned this by finishing the 30-Day Challenge. Design what comes next.
        </div>
      </div>

      {/* Challenge name */}
      <div style={{ marginBottom:18 }}>
        <div style={fieldLabel}>Challenge name — a song, a play style, anything</div>
        <input value={name} onChange={e=>setName(e.target.value)} maxLength={40}
          placeholder='e.g. "Wonderwall" or "Fingerstyle"' style={inputStyle} />
      </div>

      {/* Days */}
      <div style={{ marginBottom:18 }}>
        <div style={fieldLabel}>Number of days ({BUILD_MIN_DAYS}–{BUILD_MAX_DAYS})</div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={()=>setDays(d=>clampDays(Number(d)-1))} style={{ width:44, height:44, borderRadius:12,
            border:"1px solid #241d10", background:"#100d09", color:"#FFBE0B", fontSize:20, fontWeight:900,
            cursor:"pointer", fontFamily:"inherit" }}>−</button>
          <input type="number" value={days} min={BUILD_MIN_DAYS} max={BUILD_MAX_DAYS}
            onChange={e=>setDays(e.target.value)} onBlur={()=>setDays(d=>clampDays(d))}
            style={{ ...inputStyle, textAlign:"center", fontSize:20, fontWeight:900, color:"#FFBE0B", flex:1 }} />
          <button onClick={()=>setDays(d=>clampDays(Number(d)+1))} style={{ width:44, height:44, borderRadius:12,
            border:"1px solid #241d10", background:"#100d09", color:"#FFBE0B", fontSize:20, fontWeight:900,
            cursor:"pointer", fontFamily:"inherit" }}>+</button>
        </div>
      </div>

      {/* Target */}
      <div style={{ marginBottom:18 }}>
        <div style={fieldLabel}>Target — what does done look like? (optional)</div>
        <input value={target} onChange={e=>setTarget(e.target.value)} maxLength={80}
          placeholder='e.g. "Full song at 80 bpm without stopping"' style={inputStyle} />
      </div>

      {/* Practice categories */}
      <div style={{ marginBottom:22 }}>
        <div style={fieldLabel}>Practice categories (up to {BUILD_MAX_TASKS}) — tap the icon to change it</div>
        {tasks.map((t, i) => (
          <div key={t.id} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center" }}>
            <button onClick={()=>cycleIcon(i)} title="Tap to change icon" style={{ width:44, height:44,
              borderRadius:12, border:"1px solid rgba(255,190,11,0.3)", background:"rgba(255,190,11,0.07)",
              fontSize:20, cursor:"pointer", flexShrink:0 }}>{t.icon}</button>
            <input value={t.label} onChange={e=>setLabel(i, e.target.value)} maxLength={20}
              placeholder="Category name" style={{ ...inputStyle, flex:1 }} />
            {tasks.length > 1 && (
              <button onClick={()=>removeTask(i)} title="Remove" style={{ width:36, height:44, borderRadius:12,
                border:"1px solid #241d10", background:"transparent", color:"#6f6749", fontSize:16,
                cursor:"pointer", flexShrink:0 }}>×</button>
            )}
          </div>
        ))}
        {tasks.length < BUILD_MAX_TASKS && (
          <button onClick={addTask} style={{ width:"100%", padding:"11px", borderRadius:12,
            border:"1px dashed rgba(255,190,11,0.3)", background:"transparent", color:"#c9a03a",
            fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
            + Add a category
          </button>
        )}
      </div>

      {/* Theme */}
      <div style={{ marginBottom:22 }}>
        <div style={fieldLabel}>Tracker theme — {BUILD_THEMES[theme].name}</div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {Object.entries(BUILD_THEMES).map(([key, t]) => {
            const on = key === theme;
            return (
              <button key={key} onClick={()=>setTheme(key)} title={t.name} aria-label={t.name}
                style={{ width:42, height:42, borderRadius:"50%", cursor:"pointer", padding:0,
                  background:`linear-gradient(135deg, ${t.a}, ${t.b})`,
                  border: on ? "2px solid #f3ead2" : "2px solid transparent",
                  outline: on ? `1px solid ${hexToRgba(t.b, 0.6)}` : "none", outlineOffset:2,
                  boxShadow: on ? `0 0 18px ${hexToRgba(t.b, 0.55)}` : `0 0 8px ${hexToRgba(t.b, 0.2)}`,
                  transform: on ? "scale(1.08)" : "scale(1)", transition:"all 0.18s ease" }} />
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <button onClick={save} style={{ ...GLOW_BTN, width:"100%",
        borderRadius:13, padding:"15px", fontSize:15 }}>
        {existing ? "Save changes" : "Create my tracker 🛠️"}
      </button>
      {onCancel && (
        <button onClick={onCancel} style={{ width:"100%", marginTop:10, background:"transparent",
          border:"1px solid #241d10", borderRadius:13, padding:"12px", fontSize:13, fontWeight:700,
          color:"#8a7f5e", cursor:"pointer", fontFamily:"inherit" }}>
          Cancel
        </button>
      )}
    </div>
  );
}

// ── The custom tracker itself — same look and rules as the 30-day grid, driven
// by the member's own config. ──
function CustomTracker({ saved, onChange, onEdit, hideGenerate = false }) {
  const config = saved.config;
  const tasks = config.tasks || [];
  const data = Array.isArray(saved.data) ? saved.data : [];
  const [celebrating, setCelebrating] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const celebratedRef = useRef(false);
  const celebrateTimerRef = useRef(null);
  const { canvasRef, launch } = useTrackerConfetti();

  // Theme accents — every color in this tracker derives from the two theme hexes.
  const T = buildTheme(config);
  const grad = `linear-gradient(135deg, ${T.a}, ${T.b})`;
  const gradBar = `linear-gradient(90deg, ${T.a}, ${T.b})`;

  // Challenge-complete celebration: fires once per tracker (persisted on the
  // saved object), not on every visit while the grid is full. Resetting the
  // days re-arms it for the next run.
  useEffect(() => {
    if (celebratedRef.current) return;
    const allDaysActive = data.length > 0 && data.every(day => tasks.some(t => day[t.id]));
    if (allDaysActive) {
      if (saved.celebrated) { celebratedRef.current = true; return; }
      if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current);
      celebrateTimerRef.current = setTimeout(() => {
        celebratedRef.current = true;
        onChange({ ...saved, celebrated: true });
        setShowModal(true);
        launch([T.a, T.b, "#ffffff", T.a, T.b]);
      }, 2500);
    } else if (celebrateTimerRef.current) {
      clearTimeout(celebrateTimerRef.current);
      celebrateTimerRef.current = null;
    }
  }, [data]); // eslint-disable-line
  useEffect(() => () => { if (celebrateTimerRef.current) clearTimeout(celebrateTimerRef.current); }, []);

  function toggle(dayIdx, taskId) {
    const next = data.map((day, i) => i === dayIdx ? { ...day, [taskId]: !day[taskId] } : day);
    const dayDone = tasks.filter(t => next[dayIdx][t.id]).length;
    if (dayDone === tasks.length) {
      setCelebrating(dayIdx);
      setTimeout(() => setCelebrating(null), 1200);
    }
    onChange({ ...saved, data: next });
  }

  function resetAll() {
    if (window.confirm(`Reset all ${config.days} days? This can't be undone.`)) {
      celebratedRef.current = false; // re-arm the celebration for the next run
      onChange({ ...saved, celebrated: false, data: Array.from({ length: config.days }, () =>
        Object.fromEntries(tasks.map(t => [t.id, false]))) });
    }
  }

  const streak = customStreak(data, tasks);
  const totalDaysActive = data.filter(d => tasks.some(t => d[t.id])).length;
  const totalChecks = data.reduce((acc, d) => acc + tasks.filter(t => d[t.id]).length, 0);
  const maxChecks = Math.max(1, config.days * tasks.length);
  const overallPct = Math.round((totalChecks / maxChecks) * 100);

  const statBox = {
    position:"relative", border:"1px solid #241d10", borderRadius:16, padding:"16px 12px",
    textAlign:"center",
    background:`radial-gradient(130% 130% at 50% 0%, ${hexToRgba(T.b, 0.07)} 0%, ${hexToRgba(T.b, 0)} 60%), #100d09`,
    boxShadow:"0 6px 18px rgba(0,0,0,0.4)",
  };
  const statV = { fontSize:30, fontWeight:900, color:T.a, lineHeight:1, letterSpacing:0.5, textShadow:`0 0 18px ${hexToRgba(T.a, 0.3)}` };
  const statL = { fontSize:9.5, color:"#6f6749", textTransform:"uppercase", letterSpacing:1, fontWeight:700, marginTop:6 };
  const gridCols = `64px repeat(${tasks.length}, 1fr) 48px`;

  return (
    <div>
      <FixedLayer>
        <canvas ref={canvasRef} style={{ position:"fixed", top:0, left:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:9999 }} />
      </FixedLayer>

      {/* Challenge-complete modal — portaled for true viewport centering */}
      {showModal && (
        <FixedLayer>
        <div onClick={()=>setShowModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)",
          zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24,
          animation:"ntcModalFade 0.4s ease both" }}>
          <style>{`@keyframes ntcModalFade { from { opacity:0; } to { opacity:1; } }`}</style>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#111", border:"1px solid #2a2a2a",
            borderRadius:24, padding:"40px 28px", maxWidth:420, width:"100%", textAlign:"center", position:"relative" }}>
            <div style={{ position:"absolute", top:0, left:0, right:0, height:3,
              background:gradBar, borderRadius:"24px 24px 0 0" }} />
            <span style={{ fontSize:64, marginBottom:8, display:"block" }}>🎯</span>
            <div style={{ fontSize:30, fontWeight:900, marginBottom:8, letterSpacing:0.5,
              background:grad, WebkitBackgroundClip:"text",
              backgroundClip:"text", WebkitTextFillColor:"transparent", lineHeight:1.15 }}>
              GOAL COMPLETE
            </div>
            <div style={{ fontSize:17, color:"#fff", fontWeight:800, marginBottom:10 }}>{config.name}</div>
            <p style={{ fontSize:14, color:"#999", lineHeight:1.7, marginBottom:16 }}>
              {config.days} days of showing up for a goal <strong style={{color:"#ccc"}}>you designed yourself</strong>.
              {config.target ? <> Target: <strong style={{color:"#ccc"}}>{config.target}</strong>.</> : null} Keep going. 🔥
            </p>
            <div style={{ fontSize:13, color:T.a, fontWeight:700, lineHeight:1.6, marginBottom:24,
              background:hexToRgba(T.a, 0.08), border:`1px solid ${hexToRgba(T.a, 0.25)}`,
              borderRadius:12, padding:"12px 14px" }}>
              📸 Screenshot this and share it in the Guitar Wins post — let the club celebrate with you!
            </div>
            <button onClick={()=>setShowModal(false)} style={{ ...GLOW_BTN,
              borderRadius:12, padding:"14px 32px", fontSize:15, width:"100%" }}>
              What's next? 🤩
            </button>
          </div>
        </div>
        </FixedLayer>
      )}

      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:22 }}>
        <div style={{ fontSize:11, letterSpacing:3, color:"#7a6a3a", fontWeight:700, textTransform:"uppercase" }}>
          🛠️ Build · {config.days}-Day Tracker
        </div>
        <div style={{ fontSize:24, fontWeight:900, marginTop:8, color:"#f3ead2", letterSpacing:0.3 }}>
          <span style={{ background:grad,
            WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent" }}>{config.name}</span>
        </div>
        {config.target ? (
          <div style={{ fontSize:12.5, color:"#776b4d", marginTop:8, lineHeight:1.6 }}>
            🎯 {config.target}
          </div>
        ) : null}
      </div>

      {/* Manage — up top so Edit is always in reach */}
      <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:20, flexWrap:"wrap" }}>
        <button onClick={onEdit} style={{ background:"transparent", border:`1px solid ${hexToRgba(T.a, 0.35)}`,
          color:T.a, fontSize:11, fontFamily:"inherit", padding:"8px 16px", borderRadius:10,
          cursor:"pointer", letterSpacing:1, fontWeight:700 }}>
          ✏️ Edit tracker
        </button>
        <button onClick={resetAll} style={{ background:"transparent", border:"1px solid #241d10", color:"#6f6749",
          fontSize:11, fontFamily:"inherit", padding:"8px 16px", borderRadius:10, cursor:"pointer", letterSpacing:1 }}>
          Reset all {config.days} days
        </button>
      </div>

      {!hideGenerate && <GenerateLauncherButton theme={T} />}

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
          <span style={{ fontSize:12, color:T.a, fontWeight:800 }}>{totalChecks} / {maxChecks} tasks</span>
        </div>
        <div style={{ height:7, background:"#1a160d", borderRadius:99, overflow:"hidden", border:"1px solid #241d10" }}>
          <div style={{ height:"100%", width:`${overallPct}%`, borderRadius:99,
            background:gradBar, boxShadow:`0 0 12px ${hexToRgba(T.b, 0.5)}`,
            transition:"width 0.5s ease" }} />
        </div>
      </div>

      {/* Day grid */}
      <div style={{ border:"1px solid #241d10", borderRadius:18, overflow:"hidden", background:"#0c0a06" }}>
        <div style={{ display:"grid", gridTemplateColumns:gridCols, background:"#100d09",
          borderBottom:"1px solid #1c1710", padding:"12px 12px", gap:6, alignItems:"center" }}>
          <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:1, color:"#5a5238", fontWeight:700 }}>Day</div>
          {tasks.map(t => (
            <div key={t.id} style={{ fontSize:9, textTransform:"uppercase", letterSpacing:0.6, color:"#5a5238",
              fontWeight:700, display:"flex", flexDirection:"column", alignItems:"center", gap:3, textAlign:"center", lineHeight:1.3 }}>
              <span style={{ fontSize:13 }}>{t.icon}</span>{t.label}
            </div>
          ))}
          <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:1, color:"#5a5238", fontWeight:700, textAlign:"right" }}>%</div>
        </div>

        {data.map((day, i) => {
          const done = tasks.filter(t => day[t.id]).length;
          const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
          const isComplete = pct === 100;
          const isPartial = pct > 0 && pct < 100;
          const isActive = done > 0;
          const emoji = isComplete ? "⭐" : isPartial ? "🔥" : null;
          const isCelebrating = celebrating === i;
          const r = 12, cx = 16, cy = 16;
          const circ = 2 * Math.PI * r;
          const offset = circ - (pct / 100) * circ;
          const ringColor = isComplete ? T.a : isPartial ? T.b : "#222";
          return (
            <div key={i} style={{ display:"grid", gridTemplateColumns:gridCols, alignItems:"center",
              padding:"0 12px", gap:6, borderBottom:"1px solid #141008", minHeight:54,
              background: isComplete ? `linear-gradient(90deg, ${hexToRgba(T.b, 0.08)}, transparent)`
                : isCelebrating ? hexToRgba(T.a, 0.10) : "transparent",
              transition:"background 0.3s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ fontSize:12.5, fontWeight:900, color:isActive?T.a:"#3a3325", letterSpacing:0.3 }}>DAY {i+1}</span>
                {emoji && <span style={{ fontSize:13 }}>{emoji}</span>}
              </div>
              {tasks.map(t => (
                <div key={t.id} style={{ display:"flex", justifyContent:"center" }}>
                  <div onClick={()=>toggle(i, t.id)} role="checkbox" aria-checked={day[t.id]} tabIndex={0}
                    onKeyDown={e=>(e.key==="Enter"||e.key===" ")&&toggle(i,t.id)}
                    style={{ width:30, height:30, borderRadius:8, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      border:`2px solid ${day[t.id] ? hexToRgba(T.a, 0.6) : "#2a2417"}`,
                      background: day[t.id]
                        ? `radial-gradient(130% 130% at 50% 0%, ${hexToRgba(T.a, 0.22)}, ${hexToRgba(T.b, 0.12)}), #16110a`
                        : "#0e0b06",
                      boxShadow: day[t.id] ? `0 0 12px ${hexToRgba(T.b, 0.35)}, inset 0 0 6px ${hexToRgba(T.a, 0.15)}` : "none",
                      transition:"all 0.16s" }}>
                    {day[t.id] && (
                      <div style={{ width:10, height:6, borderLeft:`2px solid ${T.a}`, borderBottom:`2px solid ${T.a}`,
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

    </div>
  );
}

// ─── SONG TAB — simple song builder for the main shell ───────────────────────
// Composes the SAME components as the chord and strum builders — ChordPickerPanel
// (chord set grid, chips, voicings, key detection), BuildBlock strum rows, and
// MetronomePanel (BPM + warm-glow Start) — glued to the song playback engine.
// The one deliberately new piece is the Now Playing card: the old sliding
// carousel tracked prev/next "peek" state that drifted out of sync, so here the
// current-chord card is re-keyed on every change and the slide always animates
// from truth. Dev tools (legacy authoring suite) stay behind the founder button.

const SONGBUILDER_KEY = "ntc-songbuilder-v1";

function SongBuilderTab({ audio, chordVariants, updateVariant, isDev = false, onOpenDev = null }) {
  const { init, playClick, playChordStrum, playChordClick } = audio;

  // Song chords: per-slot keys (base chord or variant key), max 10 slots.
  const [songChords, setSongChords] = useState(["G", "C", "D"]);
  const [addOpen, setAddOpen] = useState(false);      // add-chord visual popup
  const [voicingFor, setVoicingFor] = useState(null); // slot index for voicing popup

  // Strum pattern: up to 2 rows of 8 slots (row 2 = indices 8-15).
  const [strumActive, setStrumActive] = useState(() => defaultBuild(8).concat(Array(8).fill(false)));
  const [row1Size, setRow1Size] = useState(8);
  const [row2Size, setRow2Size] = useState(8);
  const [hasSecondRow, setHasSecondRow] = useState(false);

  const [bpm, setBpm] = useState(60);
  const [beatsPerChord, setBeatsPerChord] = useState(2);
  const [capo, setCapo] = useState(0);
  const [songRandom, setSongRandom] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef(null);
  const [currentStrum, setCurrentStrum] = useState(-1);
  const [chordIndex, setChordIndex] = useState(0);
  const [beatCount, setBeatCount] = useState(0);
  // ChordGrid carousel state — identical wiring to the package-view song player.
  const [slideSignal, setSlideSignal] = useState(0);
  const [slideDurMs, setSlideDurMs] = useState(380);
  const slideArmedRef = useRef(false);
  const [songPrev, setSongPrev] = useState(0);
  const [songNextDisplay, setSongNextDisplay] = useState(0);
  const [songNext2, setSongNext2] = useState(0);
  const shuffleQueueRef = useRef([]);

  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SONGBUILDER_KEY) || "[]"); } catch (_) { return []; }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [savePrompt, setSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");

  const intervalRef = useRef(null);
  const bpmRef = useRef(bpm);            useEffect(()=>{ bpmRef.current=bpm; },[bpm]);
  const bpcRef = useRef(beatsPerChord);  useEffect(()=>{ bpcRef.current=beatsPerChord; },[beatsPerChord]);
  const chordsRef = useRef(songChords);  useEffect(()=>{ chordsRef.current=songChords; },[songChords]);
  const strumRef = useRef(strumActive);  useEffect(()=>{ strumRef.current=strumActive; },[strumActive]);
  const capoRef = useRef(capo);          useEffect(()=>{ capoRef.current=capo; },[capo]);
  const randomRef = useRef(songRandom);  useEffect(()=>{ randomRef.current=songRandom; },[songRandom]);
  const r1Ref = useRef(row1Size);
  const r2Ref = useRef(row2Size);
  const has2Ref = useRef(hasSecondRow);
  useEffect(()=>{ r1Ref.current=row1Size; r2Ref.current=row2Size; has2Ref.current=hasSecondRow; },[row1Size,row2Size,hasSecondRow]);
  const chordIdxRef = useRef(0);
  const chordBeatRef = useRef(0);
  const strumBeatRef = useRef(-1);
  const firstTickRef = useRef(true);

  // Shuffle queue — same no-repeat lookahead the package-view song uses, so the
  // carousel's peeks are always known ahead of time.
  const makeSongShuffle = (len, avoidFirst = null) => {
    const a = Array.from({ length: len }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (avoidFirst != null && len > 1 && a[0] === avoidFirst) { [a[0], a[1]] = [a[1], a[0]]; }
    return a;
  };
  const refillSongQueue = (len) => {
    const q = shuffleQueueRef.current;
    const last = q.length ? q[q.length - 1] : null;
    shuffleQueueRef.current = q.concat(makeSongShuffle(len, last));
  };
  const ensureSongQueue = (len, min = 8) => {
    while (shuffleQueueRef.current.length < min) refillSongQueue(len);
  };

  const tick = useCallback(() => {
    const r1 = r1Ref.current, r2 = r2Ref.current, has2 = has2Ref.current;
    const totalS = has2 ? r1 + r2 : r1;
    const nextRaw = (strumBeatRef.current + 1) % totalS;
    strumBeatRef.current = nextRaw;
    const strumIdx = nextRaw < r1 ? nextRaw : 8 + (nextRaw - r1);
    setCurrentStrum(strumIdx);
    // One bar = the FULL pattern (all rows together), so a 2-row pattern never
    // changes chords mid-pattern. "Bars per chord" counts whole cycles.
    const isBarStart = nextRaw === 0;
    const chords = chordsRef.current;
    if (isBarStart && !firstTickRef.current) {
      const nextChordBeat = (chordBeatRef.current + 1) % bpcRef.current;
      chordBeatRef.current = nextChordBeat;
      setBeatCount(nextChordBeat);
      if (nextChordBeat === 0 && chords.length > 1) {
        if (randomRef.current) {
          const len = chords.length;
          setSongPrev(chordIdxRef.current);
          ensureSongQueue(len, 8);
          const incoming = shuffleQueueRef.current.shift();
          chordIdxRef.current = incoming; setChordIndex(incoming);
          ensureSongQueue(len, 8);
          setSongNextDisplay(shuffleQueueRef.current[0]);
          setSongNext2(shuffleQueueRef.current[1]);
        } else {
          const nextChord = (chordIdxRef.current + 1) % chords.length;
          chordIdxRef.current = nextChord; setChordIndex(nextChord);
        }
      }
    }
    // Slide trigger — start the carousel slide exactly 2 arrows before the
    // pattern wraps on the chord's final run-through (same as package view).
    if (chords.length > 1) {
      const onFinalRun = chordBeatRef.current === bpcRef.current - 1;
      const tickMs = (60 / bpmRef.current / 2) * 1000;
      const lead = 2;
      const slideStartRaw = (totalS - lead + totalS) % totalS;
      if (onFinalRun && nextRaw === slideStartRaw && !slideArmedRef.current && !firstTickRef.current) {
        slideArmedRef.current = true;
        setSlideDurMs(lead * tickMs);
        setSlideSignal(s => s + 1);
      }
      if (nextRaw === 0) slideArmedRef.current = false;
    }
    firstTickRef.current = false;
    if (nextRaw % 2 === 0) playChordClick(nextRaw === 0);
    const isDown = strumIdx % 2 === 0;
    if (strumRef.current[strumIdx]) {
      const cur = chordsRef.current[chordIdxRef.current];
      if (cur) playChordStrum(slotAudioKey(cur), isDown, capoRef.current);
    }
  }, [playChordClick, playChordStrum]);

  const startMetronome = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    strumBeatRef.current = -1; chordBeatRef.current = 0;
    firstTickRef.current = true; slideArmedRef.current = false;
    if (randomRef.current && chordsRef.current.length > 1) {
      const len = chordsRef.current.length;
      if (shuffleQueueRef.current.length < 3) {
        shuffleQueueRef.current = [];
        ensureSongQueue(len, 12);
        chordIdxRef.current = shuffleQueueRef.current.shift();
        ensureSongQueue(len, 12);
      }
      setChordIndex(chordIdxRef.current);
      setSongNextDisplay(shuffleQueueRef.current[0]);
      setSongNext2(shuffleQueueRef.current[1]);
      setBeatCount(0); setCurrentStrum(-1);
    } else {
      chordIdxRef.current = 0; shuffleQueueRef.current = [];
      setChordIndex(0); setBeatCount(0); setCurrentStrum(-1);
    }
    const ms = (60 / bpmRef.current / 2) * 1000;
    intervalRef.current = setInterval(tick, ms);
    tick();
  }, [tick]);

  const stopMetronome = useCallback(() => {
    clearInterval(intervalRef.current); intervalRef.current = null;
    setCurrentStrum(-1); setChordIndex(0); setBeatCount(0);
    strumBeatRef.current = -1; chordIdxRef.current = 0;
  }, []);

  useEffect(() => { if (isPlaying) { stopMetronome(); startMetronome(); } }, [bpm, beatsPerChord, hasSecondRow, row1Size, row2Size]); // eslint-disable-line
  useEffect(() => () => { clearInterval(intervalRef.current); clearInterval(countdownRef.current); }, []);

  useEffect(() => {
    const stop = () => {
      clearInterval(countdownRef.current); countdownRef.current = null; setCountdown(0);
      stopMetronome(); setIsPlaying(false);
    };
    const onHide = () => { if (document.hidden) stop(); };
    window.addEventListener("ntc-stop-playback", stop);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("ntc-stop-playback", stop);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", stop);
    };
  }, [stopMetronome]);

  const handleTogglePlay = async () => {
    if (countdown > 0) {
      clearInterval(countdownRef.current); countdownRef.current = null;
      setCountdown(0); startMetronome(); setIsPlaying(true);
      return;
    }
    if (isPlaying) { stopMetronome(); setIsPlaying(false); return; }
    if (!songChords.length) return;
    await init();
    setCountdown(3);
    playClick(false);
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownRef.current); countdownRef.current = null;
          startMetronome(); setIsPlaying(true);
          return 0;
        }
        playClick(false);
        return c - 1;
      });
    }, 1000);
  };

  const stopIfPlaying = () => {
    if (isPlaying || countdown > 0) {
      clearInterval(countdownRef.current); countdownRef.current = null; setCountdown(0);
      stopMetronome(); setIsPlaying(false);
    }
  };

  // ── Save / load ──
  const persistSaved = (list) => {
    setSaved(list);
    try { localStorage.setItem(SONGBUILDER_KEY, JSON.stringify(list)); } catch (_) {}
  };
  const doSave = () => {
    const name = saveName.trim() || "My Song";
    const rowSizes = hasSecondRow ? [row1Size, row2Size] : [row1Size];
    const d = encodeStrumDrill(name, strumActive.concat(Array(48).fill(false)), rowSizes,
      songChords, bpm, beatsPerChord, {}, capo, songRandom);
    persistSaved([{ id: Math.random().toString(36).slice(2, 9), at: new Date().toISOString(), name, d },
      ...saved].slice(0, 30));
    setSavePrompt(false); setSaveName("");
  };
  const loadSong = (item) => {
    const dd = decodeStrumDrill(item.d);
    if (!dd) return;
    if (isPlaying || countdown > 0) {
      clearInterval(countdownRef.current); countdownRef.current = null; setCountdown(0);
      stopMetronome(); setIsPlaying(false);
    }
    setSongChords(dd.songChords.length ? dd.songChords : ["G"]);
    setStrumActive(dd.strumActive.slice(0, 16));
    setRow1Size(dd.row1Size); setRow2Size(dd.row2Size); setHasSecondRow(dd.hasSecondRow);
    setBpm(dd.bpm); setBeatsPerChord(dd.beatsPerChord); setCapo(dd.capo || 0);
    setSongRandom(!!dd.random);
    setShowSaved(false);
  };

  const nextChordIndex = songChords.length > 0 ? (songRandom ? songNextDisplay : (chordIndex + 1) % songChords.length) : 0;
  const isLastBeat = isPlaying && beatCount === beatsPerChord - 1;

  return (
    <div style={{ maxWidth:560, margin:"0 auto", padding:"24px 16px 30px" }}>
      {/* ── Your song — compact chips; chord picking happens in a portaled
          popup so it centers on the SCREEN (the tab's transform-animated
          wrapper hijacks position:fixed, which is why the old voicing modal
          landed mid-column). ── */}
      <div style={{ background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:20,
        padding:"16px 14px", marginBottom:16, boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ width:44 }} />
          <div style={{ fontSize:11, color:"#888", letterSpacing:2 }}>YOUR SONG · {songChords.length}/10</div>
          {songChords.length > 0
            ? <button onClick={()=>{ stopIfPlaying(); setSongChords([]); }}
                style={{ background:"rgba(231,76,60,0.08)", border:"1px solid rgba(231,76,60,0.45)",
                color:"#ff6b5e", fontSize:11, fontWeight:800, cursor:"pointer", letterSpacing:0.5,
                padding:"5px 11px", borderRadius:9, fontFamily:"inherit" }}>Reset</button>
            : <div style={{ width:44 }} />}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center" }}>
          {songChords.map((c, i) => {
            const base = slotBase(c);
            const isVar = base !== c;
            const active = isPlaying && i === chordIndex;
            return (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 6px 4px 10px",
                borderRadius:20, background: active ? "rgba(255,190,11,0.2)" : "rgba(255,190,11,0.1)",
                border:`1px solid ${active ? "rgba(255,190,11,0.7)" : "rgba(255,190,11,0.3)"}`,
                fontSize:12, fontWeight:800, color:"#FFBE0B",
                boxShadow: active ? "0 0 12px rgba(255,170,20,0.3)" : "none", transition:"all 0.2s" }}>
                <span style={{ fontSize:9, color:"#888", marginRight:1 }}>{i + 1}</span>
                {slotLabel(c)}
                {HAS_VARIATIONS.has(base) && (
                  <button onClick={()=>{ setVoicingFor(i); }} aria-label={`${slotLabel(c)} voicings`}
                    style={{ minWidth:30, height:26, borderRadius:8, padding:"0 6px",
                      border:`1px solid ${isVar ? "rgba(255,190,11,0.65)" : "rgba(255,190,11,0.35)"}`,
                      background: isVar ? "rgba(255,190,11,0.15)" : "rgba(10,8,4,0.6)",
                      color: isVar ? "#FFD60A" : "#c9a03a", fontSize:13, cursor:"pointer",
                      lineHeight:1, fontFamily:"inherit" }}>⚙</button>
                )}
                <button onClick={()=>{ stopIfPlaying(); setSongChords(prev => prev.filter((_, x) => x !== i)); }}
                  aria-label={`Remove ${slotLabel(c)}`} style={{ background:"none", border:"none",
                  color:"#666", fontSize:13, cursor:"pointer", padding:"0 2px", lineHeight:1 }}>×</button>
              </div>
            );
          })}
          {songChords.length < 10 && (
            <button onClick={()=>setAddOpen(true)} style={{ padding:"7px 14px", borderRadius:20,
              border:"1px dashed rgba(255,190,11,0.4)", background:"transparent", color:"#FFBE0B",
              fontSize:12.5, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
              + Chord
            </button>
          )}
        </div>
        {songChords.length > 0 && (
          <div style={{ fontSize:10.5, color:"#5a5238", textAlign:"center", marginTop:10, letterSpacing:0.5 }}>
            {(() => {
              const keys = getPossibleKeys([...new Set(songChords.map(slotBase))]);
              return keys.length ? `KEY: ${keys.map(k => k.label).join(" · ")}` : "Outside a single key — that's allowed";
            })()}
          </div>
        )}
      </div>

      {/* ── Add-chord popup — chord VISUALS, basic voicing auto-selected ── */}
      {addOpen && (
        <FixedLayer>
        <div onClick={()=>setAddOpen(false)} style={{ position:"fixed", inset:0, zIndex:1000,
          background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center",
          padding:20, animation:"ntcModalFade 0.25s ease both" }}>
          <style>{`@keyframes ntcModalFade { from { opacity:0; } to { opacity:1; } }`}</style>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#100d09",
            border:"1px solid rgba(255,190,11,0.3)", borderRadius:20, padding:"18px 14px 14px",
            maxWidth:420, width:"100%", maxHeight:"84dvh",
            display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4, flexShrink:0 }}>
              <div style={{ width:44 }} />
              <div style={{ fontSize:11, color:"#888", letterSpacing:2 }}>ADD A CHORD</div>
              {songChords.length > 0
                ? <button onClick={()=>{ stopIfPlaying(); setSongChords([]); }}
                    style={{ background:"rgba(231,76,60,0.08)", border:"1px solid rgba(231,76,60,0.45)",
                    color:"#ff6b5e", fontSize:11, fontWeight:800, cursor:"pointer", letterSpacing:0.5,
                    padding:"5px 11px", borderRadius:9, fontFamily:"inherit" }}>Reset</button>
                : <div style={{ width:44 }} />}
            </div>
            <div style={{ fontSize:10.5, color:"#5a5238", textAlign:"center", marginBottom:12, flexShrink:0 }}>
              {songChords.length}/10 · basic shape added — tap a chip's ⚙ to change voicing
            </div>
            {/* Scrollable grid; Done stays pinned to the window's bottom margin */}
            <div style={{ overflowY:"auto", flex:1, minHeight:0, display:"grid",
              gridTemplateColumns:"repeat(3,1fr)", gap:8, alignContent:"start" }}>
              {ALL_CHORDS.map(chord => {
                const allowed = getAllowedChords([...new Set(songChords.map(slotBase))]);
                const outside = allowed && !allowed.has(chord);
                const full = songChords.length >= 10;
                // Slots this chord already occupies (1-based) — duplicates allowed.
                const positions = songChords.reduce((a, c, i) => slotBase(c) === chord ? [...a, i + 1] : a, []);
                const isSel = positions.length > 0;
                return (
                  <button key={chord} disabled={full} aria-pressed={isSel} onClick={()=>{
                    stopIfPlaying();
                    const newIdx = songChords.length;
                    if (newIdx >= 10) return;
                    setSongChords(prev => prev.length >= 10 ? prev : [...prev, chord]);
                    // Straight to the voicings for the slot just added — basic
                    // shape already selected, one tap to keep or swap.
                    if (HAS_VARIATIONS.has(chord)) setVoicingFor(newIdx);
                  }} style={{ position:"relative", borderRadius:14, padding:"6px 4px 8px",
                    cursor: full ? "default" : "pointer", fontFamily:"inherit",
                    border: isSel ? "2px solid rgba(255,190,11,0.75)" : "1px solid #241d10",
                    background: isSel ? "rgba(255,190,11,0.06)" : "#0c0a06",
                    boxShadow: isSel ? "0 0 14px rgba(255,170,20,0.3)" : "none",
                    opacity: full ? 0.4 : 1, filter: outside && !isSel ? "grayscale(55%) brightness(0.75)" : "none",
                    transition:"all 0.15s" }}>
                    {isSel && (
                      <span style={{ position:"absolute", top:5, right:5, zIndex:2,
                        background:"linear-gradient(135deg,#FFD60A,#F77F00)", color:"#111",
                        borderRadius:9, padding:"2px 7px", fontSize:11, fontWeight:900,
                        boxShadow:"0 1px 6px rgba(0,0,0,0.6)" }}>
                        {positions.join(" ")}
                      </span>
                    )}
                    {getChordImg(chord, {})
                      ? <img src={getChordImg(chord, {})} alt={chord} style={{ width:"100%", display:"block", borderRadius:8 }} />
                      : <div style={{ aspectRatio:"3/4", display:"flex", alignItems:"center",
                          justifyContent:"center", fontSize:20, fontWeight:900, color:"#d8cba0" }}>{chord}</div>}
                    <div style={{ fontSize:12, fontWeight:900, color: isSel ? "#FFD60A" : "#d8cba0", marginTop:4 }}>{chord}</div>
                  </button>
                );
              })}
            </div>
            <button onClick={()=>setAddOpen(false)} style={{ ...GLOW_BTN, width:"100%", marginTop:12,
              flexShrink:0, borderRadius:12, padding:"12px", fontSize:14 }}>Done</button>
          </div>
        </div>
        </FixedLayer>
      )}

      {/* ── Voicing popup — visual tiles, current highlighted ── */}
      {voicingFor != null && songChords[voicingFor] != null && (
        <FixedLayer>
        <div onClick={()=>setVoicingFor(null)} style={{ position:"fixed", inset:0, zIndex:1000,
          background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center",
          padding:20, animation:"ntcModalFade 0.25s ease both" }}>
          <style>{`@keyframes ntcModalFade { from { opacity:0; } to { opacity:1; } }`}</style>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#100d09",
            border:"1px solid rgba(255,190,11,0.3)", borderRadius:20, padding:"18px 14px",
            maxWidth:420, width:"100%", maxHeight:"84dvh", overflowY:"auto" }}>
            <div style={{ fontSize:11, color:"#888", letterSpacing:2, textAlign:"center", marginBottom:4 }}>
              {slotBase(songChords[voicingFor])} VOICINGS
            </div>
            <div style={{ fontSize:10.5, color:"#5a5238", textAlign:"center", marginBottom:12 }}>
              basic shape selected — tap to keep or swap
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              {(CHORD_VARIATION_MAP[slotBase(songChords[voicingFor])] || []).map(opt => {
                const on = songChords[voicingFor] === opt.key;
                return (
                  <button key={opt.key} onClick={()=>{
                    stopIfPlaying();
                    setSongChords(prev => prev.map((c, x) => x === voicingFor ? opt.key : c));
                    setVoicingFor(null);
                  }} style={{ borderRadius:14, padding:"6px 4px 8px", cursor:"pointer", fontFamily:"inherit",
                    border:`2px solid ${on ? "rgba(255,190,11,0.75)" : "#241d10"}`,
                    background: on ? "rgba(255,190,11,0.08)" : "#0c0a06",
                    boxShadow: on ? "0 0 14px rgba(255,170,20,0.3)" : "none", transition:"all 0.15s" }}>
                    {slotImg(opt.key)
                      ? <img src={slotImg(opt.key)} alt={opt.label} style={{ width:"100%", display:"block", borderRadius:8 }} />
                      : <div style={{ aspectRatio:"3/4", display:"flex", alignItems:"center",
                          justifyContent:"center", fontSize:16, fontWeight:900, color:"#d8cba0" }}>{opt.label}</div>}
                    <div style={{ fontSize:12, fontWeight:900, color: on ? "#FFD60A" : "#d8cba0", marginTop:4 }}>{opt.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        </FixedLayer>
      )}

      {/* ── Chord carousel — the SAME ChordGrid as the package view ── */}
      {songChords.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <ChordGrid chords={songChords} chordIndex={chordIndex} nextChordIndex={nextChordIndex}
            afterChordIndex={songRandom ? songNext2 : null}
            prevChordIndex={songRandom ? songPrev : null}
            isPlaying={isPlaying} accentColor="#FFBE0B" isLastBeat={isLastBeat}
            bpm={bpm} beatsPerChord={beatsPerChord} countdown={countdown}
            songMode={true} slideSignal={slideSignal} slideDurMs={slideDurMs}
            chordVariants={chordVariants} updateVariant={updateVariant}
            perSlot={true} setCustomChords={setSongChords} />
          {beatsPerChord > 1 && (
            <div style={{ display:"flex", justifyContent:"center", gap:9, marginTop:12 }}>
              {Array.from({ length: beatsPerChord }, (_, i) => (
                <div key={i} style={{ width:14, height:14, borderRadius:"50%",
                  border:"1px solid #2a2417",
                  background: isPlaying && i <= beatCount ? "#FFBE0B" : "#1a160d",
                  boxShadow: isPlaying && i <= beatCount ? "0 0 12px rgba(255,170,20,0.6)" : "none",
                  transition:"all 0.2s" }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Practice — strumming, settings and metronome in ONE card ── */}
      <div style={{ background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:20,
        padding:"16px 14px", marginBottom:16, boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:12 }}>
          <div style={{ fontSize:11, color:"#888", letterSpacing:2 }}>STRUM PATTERN</div>
          {/* One length control for the whole pattern — applies to every row */}
          <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
            const ns = cycleRowSize(row1Size);
            setRow1Size(ns); setRow2Size(ns);
            setStrumActive(p=>{ const n=[...p];
              for(let i=ns;i<8;i++) n[i]=false;
              for(let i=8+ns;i<16;i++) n[i]=false;
              return n; });
          }} style={{ padding:"4px 12px", borderRadius:8, border:"1px solid #333",
            background:"#1a1a1a", color:"#FFBE0B", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            {rowSizeLabel(row1Size)} ↻
          </button>
        </div>
        {[0, ...(hasSecondRow ? [1] : [])].map(row => {
          const size = row === 0 ? row1Size : row2Size;
          return (
            <div key={row} style={{ marginBottom:10 }}>
              <div style={{ textAlign:"center", fontSize:10, color:"#444", letterSpacing:1, marginBottom:5 }}>
                ROW {row + 1}
              </div>
              <div style={{ display:"flex", gap:4, justifyContent:"center", flexWrap:"nowrap" }}>
                {Array(size).fill(null).map((_, i) => {
                  const idx = row * 8 + i;
                  return (
                    <div key={idx} style={{ flex:"1 1 0", minWidth:0, maxWidth:40, aspectRatio:"1/1", display:"flex" }}>
                      <BuildBlock dir={DIRS16[i % 8]} active={strumActive[idx]} beat={currentStrum===idx&&isPlaying} fluid
                        onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
                          setStrumActive(p=>p.map((v,x)=>x===idx?!v:v)); }} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:14 }}>
          {hasSecondRow ? (
            <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
              setHasSecondRow(false);
              setStrumActive(p=>{ const n=[...p]; for(let i=8;i<16;i++) n[i]=false; return n; });
            }} style={{ padding:"6px 14px", borderRadius:9, border:"1px solid #333",
              background:"transparent", color:"#8a7f5e", fontSize:12, fontWeight:700,
              cursor:"pointer", fontFamily:"inherit" }}>× Remove Row 2</button>
          ) : (
            <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);} setHasSecondRow(true); }}
              style={{ padding:"6px 14px", borderRadius:9, border:"1px dashed rgba(255,190,11,0.4)",
              background:"transparent", color:"#FFBE0B", fontSize:12, fontWeight:700,
              cursor:"pointer", fontFamily:"inherit" }}>+ Add Row</button>
          )}
          {/* Copy Row: row 2 becomes a copy of row 1 (creates it if needed) */}
          <button onClick={()=>{ if(isPlaying){stopMetronome();setIsPlaying(false);}
            setHasSecondRow(true);
            setStrumActive(p=>{ const n=[...p]; for(let i=0;i<8;i++) n[8+i] = i < row1Size ? p[i] : false; return n; });
          }} style={{ padding:"6px 14px", borderRadius:9, border:"1px dashed rgba(255,190,11,0.4)",
            background:"transparent", color:"#FFBE0B", fontSize:12, fontWeight:700,
            cursor:"pointer", fontFamily:"inherit" }}>⧉ Copy Row</button>
        </div>

        <div style={{ height:1, background:"#1c1710", margin:"2px 0 14px" }} />

        <div style={{ display:"grid", gridTemplateColumns:"1.15fr 1fr 0.75fr", gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:9.5, color:"#888", letterSpacing:1.5, textAlign:"center", marginBottom:7 }}>BARS PER CHORD</div>
            <div style={{ display:"flex", gap:5 }}>
              {BEATS_OPTIONS.map(v => (
                <button key={v} onClick={() => setBeatsPerChord(v)} style={{ flex:1, padding:"10px 0",
                  borderRadius:11, border:`1px solid ${beatsPerChord === v ? "rgba(255,190,11,0.55)" : "#241d10"}`,
                  background: beatsPerChord === v ? "rgba(255,190,11,0.1)" : "#100d09",
                  color: beatsPerChord === v ? "#FFD60A" : "#8a7f5e", fontSize:14, fontWeight:900,
                  cursor:"pointer", fontFamily:"inherit" }}>{v}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:9.5, color:"#888", letterSpacing:1.5, textAlign:"center", marginBottom:7 }}>CAPO</div>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <button onClick={() => setCapo(c => Math.max(0, c - 1))} style={{ width:36, height:40,
                borderRadius:11, border:"1px solid #241d10", background:"#100d09", color:"#FFBE0B",
                fontSize:16, fontWeight:900, cursor:"pointer", fontFamily:"inherit" }}>−</button>
              <div style={{ flex:1, textAlign:"center", fontSize:16, fontWeight:900, color:"#FFBE0B",
                background:"#100d09", border:"1px solid #241d10", borderRadius:11, padding:"9px 0" }}>{capo}</div>
              <button onClick={() => setCapo(c => Math.min(7, c + 1))} style={{ width:36, height:40,
                borderRadius:11, border:"1px solid #241d10", background:"#100d09", color:"#FFBE0B",
                fontSize:16, fontWeight:900, cursor:"pointer", fontFamily:"inherit" }}>+</button>
            </div>
          </div>
          <div>
            <div style={{ fontSize:9.5, color:"#888", letterSpacing:1.5, textAlign:"center", marginBottom:7 }}>RANDOM</div>
            <button onClick={() => setSongRandom(v => !v)} aria-pressed={songRandom} style={{ width:"100%",
              height:40, borderRadius:11,
              border:`1px solid ${songRandom ? "rgba(255,190,11,0.55)" : "#241d10"}`,
              background: songRandom ? "rgba(255,190,11,0.1)" : "#100d09",
              color: songRandom ? "#FFD60A" : "#8a7f5e", fontSize:13, fontWeight:900,
              cursor:"pointer", fontFamily:"inherit" }}>
              🎲 {songRandom ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <div style={{ height:1, background:"#1c1710", margin:"2px 0 14px" }} />

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <span style={{ fontSize:12, fontWeight:800, color:"#d8cba0" }}>BPM</span>
          <span style={{ fontSize:18, fontWeight:900, color:"#FFBE0B" }}>{bpm}</span>
        </div>
        <input type="range" min={20} max={160} value={bpm} className="ntc-bpm-slider"
          onChange={e=>setBpm(Number(e.target.value))} style={{ marginBottom:6, width:"100%" }} />
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:14 }}>
          {[40,60,80,100].map(b=>(
            <button key={b} onClick={()=>setBpm(b)} style={{
              flex:1, maxWidth:90, padding:"10px 0", borderRadius:12,
              border:`1px solid ${bpm===b ? "rgba(255,190,11,0.5)" : "#241d10"}`,
              background:bpm===b?"rgba(255,190,11,0.1)":"#100d09",
              color:bpm===b?"#FFD60A":"#8a7f5e", fontSize:14, fontWeight:800, cursor:"pointer",
              fontFamily:"inherit", transition:"all 0.2s" }}>{b}</button>
          ))}
        </div>
        <button onClick={handleTogglePlay} disabled={!songChords.length} style={{
          width:"100%", padding:"14px", borderRadius:14,
          border: !songChords.length ? "1px solid #1c1710"
            : (isPlaying||countdown>0) ? "1px solid rgba(231,76,60,0.5)"
            : "1px solid rgba(255,190,11,0.5)",
          background: !songChords.length ? "#100d09"
            : (isPlaying||countdown>0) ? "radial-gradient(120% 160% at 50% 0%, rgba(231,76,60,0.18) 0%, rgba(231,76,60,0) 70%), #1a0f0c"
            : "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.2) 0%, rgba(255,170,30,0) 70%), #16110a",
          color:!songChords.length?"#3a3528": (isPlaying||countdown>0) ? "#ff8a7a" : "#FFD60A",
          fontSize:16, fontWeight:900, letterSpacing:0.5,
          cursor:songChords.length?"pointer":"not-allowed",
          boxShadow: !songChords.length?"none"
            : (isPlaying||countdown>0) ? "0 0 22px rgba(231,76,60,0.2)"
            : "0 0 22px rgba(255,160,20,0.22)",
          fontFamily:"inherit", transition:"all 0.2s" }}>
          {!songChords.length ? "Add a chord to start"
            : countdown>0
              ? <><span style={{ fontSize:22, fontWeight:900 }}>{countdown}</span>
                  <span style={{ fontSize:11, fontWeight:700, opacity:0.7, marginLeft:8 }}>tap to skip</span></>
              : isPlaying ? "⏹ Stop" : "▶ Start"}
        </button>
      </div>

      {/* ── Save / My songs ── */}
      <div style={{ display:"flex", gap:8, justifyContent:"center", marginTop:20 }}>
        <button onClick={() => { setSavePrompt(v => !v); setShowSaved(false); }} style={{ ...GLOW_BTN,
          borderRadius:12, padding:"11px 22px", fontSize:13 }}>💾 Save</button>
        {saved.length > 0 && (
          <button onClick={() => { setShowSaved(v => !v); setSavePrompt(false); }} style={{ padding:"11px 22px",
            borderRadius:12, border:"1px solid rgba(255,190,11,0.35)", background:"#14100a",
            color:"#c9a03a", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
            📂 My Songs ({saved.length})
          </button>
        )}
      </div>
      {savePrompt && (
        <div style={{ display:"flex", gap:8, marginTop:10 }}>
          <input value={saveName} onChange={e => setSaveName(e.target.value)} maxLength={40}
            placeholder="Song name" style={{ flex:1, boxSizing:"border-box", background:"#0e0b06",
            border:"1px solid #241d10", borderRadius:12, padding:"12px 14px", fontSize:14,
            color:"#f3ead2", fontFamily:"inherit", outline:"none" }} />
          <button onClick={doSave} style={{ ...GLOW_BTN, borderRadius:12, padding:"11px 20px", fontSize:13 }}>Save</button>
        </div>
      )}
      {showSaved && saved.map(s => (
        <div key={s.id} style={{ display:"flex", alignItems:"center", gap:8, marginTop:8,
          border:"1px solid #241d10", borderRadius:13, background:"#0e0b07", padding:"10px 12px" }}>
          <div style={{ flex:1, fontSize:13.5, fontWeight:800, color:"#f3ead2", whiteSpace:"nowrap",
            overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</div>
          <button onClick={() => loadSong(s)} style={{ ...GLOW_BTN, borderRadius:10, padding:"8px 16px", fontSize:12 }}>Open</button>
          <button onClick={() => persistSaved(saved.filter(x => x.id !== s.id))} aria-label="Delete"
            style={{ width:30, height:34, borderRadius:10, border:"1px solid #241d10", background:"transparent",
            color:"#6f6749", fontSize:14, cursor:"pointer" }}>×</button>
        </div>
      ))}

      {/* Founder-only door to the legacy authoring suite */}
      {isDev && onOpenDev && (
        <div style={{ textAlign:"center", marginTop:26 }}>
          <button onClick={onOpenDev} style={{ padding:"8px 16px", borderRadius:10,
            border:"1px solid #241d10", background:"transparent", color:"#5a5238",
            fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", letterSpacing:1 }}>
            🛠 Dev tools →
          </button>
        </div>
      )}
    </div>
  );
}


// ─── EXERCISE GENERATOR ──────────────────────────────────────────────────────
// "Generate Exercise" — visible on every tracker. Members pick Chord Switching /
// Strumming / Song, cycle a difficulty per exercise (Easy → Med → Hard), choose
// chord/row counts, and get a randomly generated package rendered with the same
// components as shared packages (drill / strum / song params), plus their
// tracker. Regenerate updates the active exercise (and the song, since the song
// is always chords + strumming combined). Save/Load keeps favorites locally and
// syncs them through the progress table.

const GEN_SAVED_KEY = "ntc-generated-v1";
const GEN_DIFFS = ["easy", "medium", "hard"];
const GEN_DIFF_META = {
  easy:   { label: "Easy", color: "#7ED957" },
  medium: { label: "Med",  color: "#FFBE0B" },
  hard:   { label: "Hard", color: "#FF5A5F" },
};

// Chord pools. Values are per-slot chord keys the drill/song components render
// directly. Easy = the Anchored 4 (G anchored, Cadd9, Em7, Dsus4). Medium =
// open chords, no anchors. Hard = barre-leaning chords plus variations
// (7ths, slash chords), no anchors.
const GEN_CHORD_POOLS = {
  easy:   ["G_anchor", "C_anchor", "Em_anchor", "D_anchor"],
  medium: ["G", "C", "Em", "E", "D", "Am", "Fmaj7", "Dm"],
  hard:   ["G", "C", "Em", "D", "Am", "Fmaj7", "Dm", "Bm", "A", "E",
           "A7", "B7", "E7", "Am7", "C/G", "G/B", "C/B", "Am/G"],
};

// Count defaults follow difficulty (cycling a difficulty resets its count to
// the default; members can still adjust after). Caps: up to 6 of each, except
// Easy chords, whose pool is the Anchored 4.
const GEN_DEFAULT_CHORDS = { easy: 2, medium: 4, hard: 6 };
const GEN_DEFAULT_ROWS   = { easy: 1, medium: 2, hard: 3 };
const GEN_MAX_ROWS = 6;
function genMaxChords(diff) { return Math.min(6, GEN_CHORD_POOLS[diff].length); }

// Strum pattern pools. 8 slots on a fixed D-U-D-U grid ("-" = skip). Easy keeps
// the downbeats anchored with a few gaps; Medium adds syncopation; Hard leans
// on off-beat ups and sparse hits.
const GEN_STRUM_POOLS = {
  easy:   ["D-D-D-D-", "DUD-DUD-", "D-DU--DU", "D-DUD-D-", "DUDUD-D-", "D-D-DUDU", "D-DUDU--", "DUD-D-D-"],
  medium: ["-UDU--DU", "D-DU-UDU", "DU-UDU-U", "D--UDUDU", "-UDUD-DU", "D-DUDU-U", "DUDU-U-U", "D--U-UDU"],
  hard:   ["-U-UD--U", "-U--DU-U", "--DU-U-U", "-UD--U-U", "D--U--DU", "-U-U-UDU", "--D--UDU", "-UDU-U--"],
};

const GEN_BPM = { easy: 60, medium: 65, hard: 70 };

// What each difficulty means, shown live on the setup screen.
const GEN_DIFF_DESC = {
  chords: {
    easy:   "The Anchored 4 — G (anchored), Cadd9, Em7 & Dsus4",
    medium: "Open chords — G, C, Em, E, D, Am, Fmaj7, Dm",
    hard:   "Open chords + variations — 7ths, slash chords, Bm & barre shapes",
  },
  strum: {
    easy:   "Steady down-strums with a couple of gaps · 60 bpm",
    medium: "Syncopated patterns with off-beat ups · 65 bpm",
    hard:   "Sparse, off-beat-heavy patterns · 70 bpm",
  },
  song: {
    easy:   "Your chords + strumming · 60 bpm · chord change every 2 bars",
    medium: "Your chords + strumming · 65 bpm · chord change every 2 bars",
    hard:   "Your chords + strumming · 70 bpm · chord change every bar",
  },
};
const GEN_BEATS_PER_CHORD = { easy: 2, medium: 2, hard: 1 };

// Generated session names, flavored by the toughest selected difficulty.
const GEN_NAME_ADJ = {
  easy:   ["Campfire", "Sunrise", "Porch", "Backyard", "Sunday", "Mellow"],
  medium: ["Highway", "Neon", "Boardwalk", "Canyon", "Electric", "Midnight"],
  hard:   ["Thunder", "Wildfire", "Overdrive", "Renegade", "Avalanche", "Voltage"],
};
const GEN_NAME_NOUN = ["Session", "Sprint", "Circuit", "Workout", "Jam", "Run", "Set"];

function genPick(pool) { return pool[Math.floor(Math.random() * pool.length)]; }
function genSample(pool, n) {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(1, Math.min(n, arr.length)));
}
function genName(diffs) {
  const rank = { easy: 0, medium: 1, hard: 2 };
  const top = diffs.reduce((a, b) => (rank[b] > rank[a] ? b : a), "easy");
  return `${genPick(GEN_NAME_ADJ[top])} ${genPick(GEN_NAME_NOUN)}`;
}

// Map 8-char pattern rows onto the 64-slot strumActive array (row r = slots
// r*8..r*8+7), matching the Strumming builder's storage exactly.
function genPatternsToActive(rows) {
  const act = Array(64).fill(false);
  rows.forEach((pat, r) => {
    for (let i = 0; i < 8 && i < pat.length; i++) {
      if (pat[i] === "D" || pat[i] === "U") act[r * 8 + i] = true;
    }
  });
  return act;
}

// Derive the three share-format params from generated content. Same encoders
// the share links use, so the existing tab components consume them verbatim.
function genParams(gen) {
  const cd = gen.sel.chords ? gen.diff.chords : gen.diff.song;
  const sd = gen.sel.strum ? gen.diff.strum : gen.diff.song;
  const songD = gen.diff.song;
  const out = {};
  if (gen.sel.chords) {
    out.drill = encodeChordDrill(gen.chords, GEN_BPM[cd], 2, `${gen.name} · Chords`, {}, false);
  }
  if (gen.sel.strum) {
    out.strum = encodeStrumDrill(`${gen.name} · Strumming`, genPatternsToActive(gen.rows),
      gen.rows.map(() => 8), [], GEN_BPM[sd], 2, {}, 0, false);
  }
  if (gen.sel.song) {
    const songRows = gen.rows.slice(0, 2); // simple song supports up to 2 pattern rows
    out.song = encodeStrumDrill(`${gen.name} · Song`, genPatternsToActive(songRows),
      songRows.map(() => 8), gen.chords, GEN_BPM[songD], GEN_BEATS_PER_CHORD[songD], {}, 0, false);
  }
  return out;
}

// ── Launcher — the shiny entry button rendered on every tracker ──
function GenerateLauncherButton({ theme = null }) {
  // Matches the custom tracker's chosen theme; house gold by default.
  const a = theme ? theme.a : "#FFBE0B";
  const b = theme ? theme.b : "#FFAA1E";
  const text = theme ? theme.a : "#FFD60A";
  return (
    <button onClick={() => { try { window.dispatchEvent(new CustomEvent("ntc-open-generator")); } catch (_) {} }}
      style={{ position:"relative", overflow:"hidden", width:"100%",
        border:`1px solid ${hexToRgba(a, 0.55)}`,
        background:`radial-gradient(120% 160% at 50% 0%, ${hexToRgba(b, 0.18)} 0%, ${hexToRgba(b, 0)} 65%), #16110a`,
        color:text, fontWeight:900, cursor:"pointer", fontFamily:"inherit",
        boxShadow:`0 0 22px ${hexToRgba(b, 0.18)}, inset 0 1px 0 rgba(255,255,255,0.04)`,
        borderRadius:14, padding:"14px", fontSize:14.5, letterSpacing:0.4, marginBottom:22 }}>
      <style>{`@keyframes ntcGenShine { 0% { transform:translateX(-100%); } 28%, 100% { transform:translateX(100%); } }`}</style>
      <span style={{ position:"absolute", inset:0, pointerEvents:"none",
        background:"linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.14) 50%, transparent 60%)",
        transform:"translateX(-100%)", animation:"ntcGenShine 6.8s ease 0.6s infinite" }} />
      ⚡ Generate Exercise
    </button>
  );
}

// ── The generator itself. Mounted once per host view (main app shell and
// package view — wherever a tracker lives), opened via the launcher's event. ──
function ExerciseGeneratorHost({ audio, chordVariants, updateVariant, context = "app" }) {
  const [stage, setStage] = useState(null); // null | "setup" | "view"
  const [sel, setSel] = useState({ chords: true, strum: true, song: true });
  const [diff, setDiff] = useState({ chords: "easy", strum: "easy", song: "easy" });
  const [chordCount, setChordCount] = useState(GEN_DEFAULT_CHORDS.easy);
  const [rowCount, setRowCount] = useState(GEN_DEFAULT_ROWS.easy);
  const [gen, setGen] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [activeKey, setActiveKey] = useState("drill");
  const [savedList, setSavedList] = useState(() => {
    try { return JSON.parse(localStorage.getItem(GEN_SAVED_KEY) || "[]"); } catch (_) { return []; }
  });
  const [showLoad, setShowLoad] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Open on the launcher's event.
  useEffect(() => {
    const open = () => { setStage("setup"); setShowLoad(false); };
    window.addEventListener("ntc-open-generator", open);
    return () => window.removeEventListener("ntc-open-generator", open);
  }, []);

  // Lock the page scroll behind the overlay.
  useEffect(() => {
    if (!stage) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [stage]);

  const stopPlayback = () => { try { window.dispatchEvent(new Event("ntc-stop-playback")); } catch (_) {} };
  const close = () => { stopPlayback(); setStage(null); };

  // Effective difficulty for counts/pools when a component rides along only
  // inside the song (its own row unselected).
  const anySelected = sel.chords || sel.strum || sel.song;

  const cycleDiff = (id) => {
    if (!sel[id]) return;
    setDiff(prev => {
      const next = GEN_DIFFS[(GEN_DIFFS.indexOf(prev[id]) + 1) % GEN_DIFFS.length];
      // Counts follow the difficulty default; members can still adjust after.
      if (id === "chords") setChordCount(GEN_DEFAULT_CHORDS[next]);
      if (id === "strum") setRowCount(GEN_DEFAULT_ROWS[next]);
      return { ...prev, [id]: next };
    });
  };
  const toggleSel = (id) => setSel(prev => ({ ...prev, [id]: !prev[id] }));

  const buildGen = (base) => {
    const cDiff = base.sel.chords ? base.diff.chords : base.diff.song;
    const sDiff = base.sel.strum ? base.diff.strum : base.diff.song;
    // If a row rides along only inside the song, its count uses the song
    // difficulty's default. Always clamped to the pool.
    const cc = Math.max(2, Math.min(
      base.sel.chords ? base.chordCount : GEN_DEFAULT_CHORDS[cDiff], genMaxChords(cDiff)));
    const rc = Math.max(1, Math.min(
      base.sel.strum ? base.rowCount : GEN_DEFAULT_ROWS[sDiff], GEN_MAX_ROWS));
    return {
      name: genName([base.sel.chords && base.diff.chords, base.sel.strum && base.diff.strum,
        base.sel.song && base.diff.song].filter(Boolean)),
      sel: { ...base.sel }, diff: { ...base.diff },
      chordCount: cc, rowCount: rc,
      chords: genSample(GEN_CHORD_POOLS[cDiff], cc),
      rows: genSample(GEN_STRUM_POOLS[sDiff], rc),
    };
  };

  const generate = () => {
    if (!anySelected || generating) return;
    setGenerating(true);
    // A short shimmer beat before the reveal — generation is instant, delight isn't.
    setTimeout(() => {
      const g = buildGen({ sel, diff, chordCount, rowCount });
      setGen(g);
      setActiveKey(g.sel.chords ? "drill" : g.sel.strum ? "strum" : "song");
      setGenerating(false);
      setStage("view");
    }, 700);
  };

  // Regenerate the active exercise. Chords or strumming also refresh the song
  // (the song is always their combination); regenerating on the song tab
  // rerolls both ingredients.
  const regenerate = () => {
    if (!gen) return;
    stopPlayback();
    setGen(prev => {
      const next = { ...prev };
      const rerollChords = activeKey === "drill" || activeKey === "song";
      const rerollRows = activeKey === "strum" || activeKey === "song";
      if (rerollChords) next.chords = genSample(GEN_CHORD_POOLS[prev.sel.chords ? prev.diff.chords : prev.diff.song], prev.chordCount);
      if (rerollRows) next.rows = genSample(GEN_STRUM_POOLS[prev.sel.strum ? prev.diff.strum : prev.diff.song], prev.rowCount);
      return next;
    });
  };

  const persistSaved = (list) => {
    setSavedList(list);
    try { localStorage.setItem(GEN_SAVED_KEY, JSON.stringify(list)); } catch (_) {}
  };
  const saveCurrent = () => {
    if (!gen) return;
    const item = { id: Math.random().toString(36).slice(2, 9), at: new Date().toISOString(),
      name: gen.name, sel: gen.sel, diff: gen.diff, chordCount: gen.chordCount,
      rowCount: gen.rowCount, chords: gen.chords, rows: gen.rows };
    persistSaved([item, ...savedList].slice(0, 24));
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1600);
  };
  const loadSaved = (item) => {
    setGen({ name: item.name, sel: { ...item.sel }, diff: { ...item.diff },
      chordCount: item.chordCount, rowCount: item.rowCount,
      chords: [...item.chords], rows: [...item.rows] });
    setSel({ ...item.sel }); setDiff({ ...item.diff });
    setChordCount(item.chordCount); setRowCount(item.rowCount);
    setActiveKey(item.sel.chords ? "drill" : item.sel.strum ? "strum" : "song");
    setStage("view");
  };
  const deleteSaved = (id) => persistSaved(savedList.filter(s => s.id !== id));

  if (!stage) return null;

  // ── Shared overlay chrome ──
  const overlayStyle = { position:"fixed", inset:0, zIndex:500, overflowY:"auto",
    background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%) #0d0d0a",
    fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" };
  const fieldLabel = { fontSize:10, textTransform:"uppercase", letterSpacing:1.5, color:"#7a6a3a",
    fontWeight:700, marginBottom:8 };

  // ── Setup screen ──
  if (stage === "setup") {
    const rowsUI = [
      { id:"chords", icon:"🤚", label:"Chord Switching" },
      { id:"strum",  icon:"🎸", label:"Strumming" },
      { id:"song",   icon:"🎵", label:"Song", sub:"chords + strumming" },
    ];
    return (
      <FixedLayer>
      <div style={overlayStyle}>
        <div style={{ maxWidth:560, margin:"0 auto", padding:"18px 16px 60px" }}>
          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
            <div style={{ width:34 }} />
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:16, fontWeight:900, letterSpacing:1.5,
                background:"linear-gradient(135deg,#FFE27A,#FFBE0B 50%,#F77F00)",
                WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent" }}>NO THEORY CLUB</div>
              <div style={{ fontSize:9, color:"#6f6749", letterSpacing:2, marginTop:2, textTransform:"uppercase" }}>
                Exercise Generator
              </div>
            </div>
            <button onClick={close} aria-label="Close" style={{ width:34, height:34, borderRadius:10,
              border:"1px solid #241d10", background:"#100d09", color:"#8a7f5e", fontSize:16,
              cursor:"pointer", fontFamily:"inherit" }}>✕</button>
          </div>

          <div style={{ textAlign:"center", margin:"18px 0 22px" }}>
            <div style={{ fontSize:24, fontWeight:900, color:"#f3ead2", letterSpacing:0.3 }}>
              What are we <span style={{ background:"linear-gradient(135deg,#FFD60A,#F77F00)",
                WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent" }}>practicing?</span>
            </div>
            <div style={{ fontSize:12.5, color:"#776b4d", marginTop:8, lineHeight:1.6 }}>
              Pick your exercises, set each difficulty, and hit generate.
            </div>
          </div>

          {/* Exercise rows: icon | label | inline count | check — one line, equal
              heights whether selected or not, stepper filling the middle space. */}
          {rowsUI.map(r => {
            const on = sel[r.id];
            const d = GEN_DIFF_META[diff[r.id]];
            const stepper = r.id === "chords"
              ? { value: Math.min(chordCount, genMaxChords(diff.chords)), set: setChordCount,
                  min: 2, max: genMaxChords(diff.chords), unit: "chords" }
              : r.id === "strum"
              ? { value: rowCount, set: setRowCount, min: 1, max: GEN_MAX_ROWS, unit: "rows" }
              : null;
            const stepBtn = { width:30, height:36, borderRadius:10, border:"1px solid #241d10",
              background:"#100d09", color:"#FFBE0B", fontSize:15, fontWeight:900,
              cursor:"pointer", fontFamily:"inherit", flexShrink:0 };
            return (
              <div key={r.id} style={{ display:"flex", gap:8, marginBottom:10, alignItems:"stretch" }}>
                <div role="button" tabIndex={0} aria-pressed={on} onClick={()=>toggleSel(r.id)}
                  onKeyDown={e=>(e.key==="Enter"||e.key===" ")&&toggleSel(r.id)}
                  style={{ flex:1, minWidth:0, padding:"10px 12px", borderRadius:14, cursor:"pointer",
                    userSelect:"none", display:"flex", alignItems:"center", gap:10, minHeight:60,
                    boxSizing:"border-box",
                    border:`1px solid ${on ? "rgba(255,190,11,0.55)" : "#241d10"}`,
                    background: on
                      ? "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.16) 0%, rgba(255,170,30,0) 65%), #16110a"
                      : "#0e0b07",
                    boxShadow: on ? "0 0 18px rgba(255,160,20,0.14)" : "none",
                    transition:"all 0.2s ease" }}>
                  <span style={{ fontSize:19, opacity: on ? 1 : 0.5, flexShrink:0 }}>{r.icon}</span>
                  <span style={{ flex:1, minWidth:0 }}>
                    <span style={{ fontSize:13.5, fontWeight:900, display:"block",
                      color: on ? "#FFD60A" : "#6f6749", whiteSpace:"nowrap", overflow:"hidden",
                      textOverflow:"ellipsis" }}>{r.label}</span>
                    {r.sub && <span style={{ fontSize:10, color: on ? "#9a8f6e" : "#4a4433",
                      fontWeight:600, whiteSpace:"nowrap" }}>{r.sub}</span>}
                  </span>
                  {on && stepper && (
                    <span onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}
                      style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                      <button aria-label={`fewer ${stepper.unit}`}
                        onClick={()=>stepper.set(v=>Math.max(stepper.min, Math.min(stepper.max, v)-1))}
                        style={stepBtn}>−</button>
                      <span style={{ width:44, textAlign:"center", background:"#0c0a06",
                        border:"1px solid #1c1710", borderRadius:10, padding:"3px 0 4px",
                        display:"inline-flex", flexDirection:"column", alignItems:"center", lineHeight:1.15 }}>
                        <span style={{ fontSize:15, fontWeight:900, color:"#FFBE0B" }}>{stepper.value}</span>
                        <span style={{ fontSize:7.5, color:"#7a6a3a", fontWeight:700, letterSpacing:0.5,
                          textTransform:"uppercase" }}>{stepper.value === 1 ? stepper.unit.slice(0, -1) : stepper.unit}</span>
                      </span>
                      <button aria-label={`more ${stepper.unit}`}
                        onClick={()=>stepper.set(v=>Math.min(stepper.max, Math.max(stepper.min, v)+1))}
                        style={stepBtn}>+</button>
                    </span>
                  )}
                  {/* Selected indicator — the subtle "this is a toggle" cue */}
                  <span aria-hidden="true" style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900,
                    border:`1.5px solid ${on ? "rgba(255,190,11,0.7)" : "#2a2417"}`,
                    background: on ? "rgba(255,190,11,0.12)" : "transparent",
                    color: on ? "#FFD60A" : "transparent", transition:"all 0.2s" }}>✓</span>
                </div>
                <button onClick={()=>cycleDiff(r.id)} disabled={!on} aria-label={`${r.label} difficulty`} style={{
                  width:76, borderRadius:14, cursor: on ? "pointer" : "default", fontFamily:"inherit",
                  fontSize:12.5, fontWeight:900, letterSpacing:0.5, flexShrink:0,
                  border:`1px solid ${on ? hexToRgba(d.color, 0.55) : "#1c1710"}`,
                  background: on
                    ? `radial-gradient(120% 160% at 50% 0%, ${hexToRgba(d.color, 0.16)} 0%, transparent 65%), #14100a`
                    : "#0c0a06",
                  color: on ? d.color : "#3a3325",
                  boxShadow: on ? `0 0 14px ${hexToRgba(d.color, 0.2)}` : "none",
                  transition:"all 0.2s ease" }}>
                  {on ? GEN_DIFF_META[diff[r.id]].label : "—"}
                </button>
              </div>
            );
          })}

          {/* What the chosen difficulties mean — updates live as they cycle */}
          {anySelected && (
            <div style={{ border:"1px solid #1c1710", borderRadius:13, background:"#0c0a06",
              padding:"11px 13px", margin:"2px 0 8px" }}>
              {rowsUI.filter(r => sel[r.id]).map(r => (
                <div key={r.id} style={{ display:"flex", alignItems:"baseline", gap:7,
                  fontSize:11, lineHeight:1.75, color:"#8a7f5e" }}>
                  <span style={{ flexShrink:0 }}>{r.icon}</span>
                  <span style={{ color: GEN_DIFF_META[diff[r.id]].color, fontWeight:900,
                    flexShrink:0, minWidth:34 }}>{GEN_DIFF_META[diff[r.id]].label}</span>
                  <span style={{ minWidth:0 }}>{GEN_DIFF_DESC[r.id][diff[r.id]]}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize:10.5, color:"#5a5238", textAlign:"center", margin:"0 0 20px", lineHeight:1.7 }}>
            Tap an exercise to include or skip it · tap its difficulty to cycle Easy → Med → Hard
          </div>

          {/* Generate — the shine button */}
          <button onClick={generate} disabled={!anySelected || generating} style={{ ...GLOW_BTN,
            position:"relative", overflow:"hidden", width:"100%", borderRadius:14,
            padding:"16px", fontSize:16, letterSpacing:0.5,
            opacity: anySelected ? 1 : 0.4 }}>
            <span style={{ position:"absolute", inset:0, pointerEvents:"none",
              background:"linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.16) 50%, transparent 60%)",
              transform:"translateX(-100%)",
              animation: generating ? "ntcGenShine 0.55s ease infinite" : "ntcGenShine 6s ease 0.4s infinite" }} />
            <style>{`@keyframes ntcGenShine { 0% { transform:translateX(-100%); } 28%, 100% { transform:translateX(100%); } }`}</style>
            {generating ? "Generating…" : "✨ Generate"}
          </button>

          {/* Load saved */}
          {savedList.length > 0 && (
            <button onClick={()=>setShowLoad(v=>!v)} style={{ width:"100%", marginTop:10, padding:"12px",
              borderRadius:13, border:"1px dashed rgba(255,190,11,0.3)", background:"transparent",
              color:"#c9a03a", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              📂 Load a saved exercise ({savedList.length})
            </button>
          )}
          {showLoad && savedList.map(s => (
            <div key={s.id} style={{ display:"flex", alignItems:"center", gap:8, marginTop:8,
              border:"1px solid #241d10", borderRadius:13, background:"#0e0b07", padding:"10px 12px" }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:800, color:"#f3ead2", whiteSpace:"nowrap",
                  overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</div>
                <div style={{ fontSize:10.5, color:"#6f6749", marginTop:2 }}>
                  {[s.sel.chords && `🤚 ${GEN_DIFF_META[s.diff.chords].label}`,
                    s.sel.strum && `🎸 ${GEN_DIFF_META[s.diff.strum].label}`,
                    s.sel.song && `🎵 ${GEN_DIFF_META[s.diff.song].label}`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button onClick={()=>loadSaved(s)} style={{ ...GLOW_BTN, borderRadius:10,
                padding:"8px 16px", fontSize:12 }}>Open</button>
              <button onClick={()=>deleteSaved(s.id)} aria-label="Delete" style={{ width:30, height:34,
                borderRadius:10, border:"1px solid #241d10", background:"transparent", color:"#6f6749",
                fontSize:14, cursor:"pointer" }}>×</button>
            </div>
          ))}
        </div>
      </div>
      </FixedLayer>
    );
  }

  // ── Generated package view ──
  const params = genParams(gen);
  const trackerName = readCustomTrackerName();
  const trackerTabLabel = !trackerName ? "Tracker" : (trackerName.length <= 10 ? trackerName : "My Tracker");
  // ChordsTab and the song builder strip "_anchor" slot keys back to open
  // shapes whenever their anchored prop is false — so Easy pools must render
  // with anchored={true} or the Anchored 4 silently become open chords.
  const anchoredChords = (gen.sel.chords ? gen.diff.chords : gen.diff.song) === "easy";
  const anchoredStrum = (gen.sel.strum ? gen.diff.strum : gen.diff.song) === "easy";
  const tabs = [];
  if (gen.sel.chords) tabs.push({ key:"drill", icon:"🤚", label:"Chords" });
  if (gen.sel.strum)  tabs.push({ key:"strum", icon:"🎸", label:"Strum" });
  if (gen.sel.song)   tabs.push({ key:"song",  icon:"🎵", label:"Song" });
  tabs.push({ key:"tracker", icon:"🔥", label:trackerTabLabel });
  const metaLine = [
    gen.sel.chords && `${GEN_DIFF_META[gen.diff.chords].label} chords`,
    gen.sel.strum && `${GEN_DIFF_META[gen.diff.strum].label} strumming`,
    gen.sel.song && `${GEN_DIFF_META[gen.diff.song].label} song`,
  ].filter(Boolean).join(" · ");

  const go = (key) => { stopPlayback(); setActiveKey(key); };

  return (
    <FixedLayer>
    <div style={overlayStyle}>
      <div style={{ maxWidth:560, margin:"0 auto", padding:"14px 16px 60px" }}>
        {/* Header: back / brand / close */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <button onClick={()=>{ stopPlayback(); setStage("setup"); }} style={{ padding:"7px 12px",
            borderRadius:10, border:"1px solid #241d10", background:"#100d09", color:"#8a7f5e",
            fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>← Setup</button>
          <div style={{ fontSize:9, color:"#6f6749", letterSpacing:2, textTransform:"uppercase" }}>
            Generated Practice
          </div>
          <button onClick={close} aria-label="Close" style={{ width:32, height:32, borderRadius:10,
            border:"1px solid #241d10", background:"#100d09", color:"#8a7f5e", fontSize:15,
            cursor:"pointer", fontFamily:"inherit" }}>✕</button>
        </div>

        {/* Title + Regenerate / Save — above all views */}
        <div style={{ textAlign:"center", margin:"14px 0 6px" }}>
          <div style={{ fontSize:26, fontWeight:900, letterSpacing:0.4,
            background:"linear-gradient(135deg,#FFE27A,#FFBE0B 50%,#F77F00)",
            WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent" }}>
            {gen.name}
          </div>
          <div style={{ fontSize:11.5, color:"#776b4d", marginTop:4, fontWeight:600 }}>{metaLine}</div>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", margin:"12px 0 14px" }}>
          {activeKey !== "tracker" && (
            <button onClick={regenerate} style={{ ...GLOW_BTN, position:"relative", overflow:"hidden",
              borderRadius:12, padding:"11px 22px", fontSize:13.5 }}>
              <span style={{ position:"absolute", inset:0, pointerEvents:"none",
                background:"linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.13) 50%, transparent 60%)",
                transform:"translateX(-100%)", animation:"ntcGenShine 6.4s ease 1s infinite" }} />
              🎲 Regenerate
            </button>
          )}
          <button onClick={saveCurrent} style={{ padding:"11px 22px", borderRadius:12,
            border:`1px solid ${justSaved ? "rgba(126,217,87,0.6)" : "rgba(255,190,11,0.35)"}`,
            background:"#14100a", color: justSaved ? "#7ED957" : "#c9a03a",
            fontSize:13.5, fontWeight:800, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
            {justSaved ? "Saved ✓" : "💾 Save"}
          </button>
        </div>

        {/* Tab pills */}
        <div style={{ display:"flex", gap:8, marginBottom:12 }}>
          {tabs.map(t => {
            const on = activeKey === t.key;
            return (
              <button key={t.key} onClick={()=>go(t.key)} style={{
                flex:1, padding:"11px 6px", borderRadius:13, fontFamily:"inherit", cursor:"pointer",
                border:`1px solid ${on ? "rgba(255,190,11,0.55)" : "#241d10"}`,
                background: on
                  ? "radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.16) 0%, rgba(255,170,30,0) 65%), #16110a"
                  : "#100d09",
                color: on ? "#FFD60A" : "#8a7f5e", fontSize:12.5, fontWeight:800,
                whiteSpace:"nowrap", transition:"all 0.2s ease" }}>
                {t.icon} {t.label}
              </button>
            );
          })}
        </div>

        {/* Panels — mounted via display toggle; keyed by content so a regenerate
            remounts only the panels whose exercise actually changed. */}
        <style>{`@keyframes ntcPanelReveal { 0%, 40% { opacity:0; } 100% { opacity:1; } }`}</style>
        {gen.sel.chords && (
          <div style={{ display: activeKey==="drill" ? "block" : "none" }}>
            <div key={`drill-${gen.chords.join("|")}`} style={{ animation:"ntcPanelReveal 0.5s ease both" }}>
              <ChordsTab audio={audio} chordVariants={chordVariants} updateVariant={updateVariant}
                sharedView={true} initialParam={params.drill} hideTitle={true} anchored={anchoredChords} />
            </div>
          </div>
        )}
        {gen.sel.strum && (
          <div style={{ display: activeKey==="strum" ? "block" : "none" }}>
            <div key={`strum-${gen.rows.join("|")}`} style={{ animation:"ntcPanelReveal 0.5s ease both" }}>
              <StrummingTab audio={audio} sharedView={true}
                initialParam={params.strum} hideTitle={true} anchored={anchoredStrum} />
            </div>
          </div>
        )}
        {gen.sel.song && (
          <div style={{ display: activeKey==="song" ? "block" : "none" }}>
            <div key={`song-${gen.chords.join("|")}-${gen.rows.slice(0,2).join("|")}`} style={{ animation:"ntcPanelReveal 0.5s ease both" }}>
              <BuildSongTab audio={audio}
                initialBuildMode="simple" chordVariants={chordVariants} updateVariant={updateVariant}
                sharedView={true} initialParam={params.song} hideTitle={true} anchored={anchoredChords} />
            </div>
          </div>
        )}
        <div style={{ display: activeKey==="tracker" ? "block" : "none" }}>
          {/* The generator was launched from Build — show THEIR tracker only,
              no 30-day challenge, no mode switcher. */}
          <CustomTrackerSection hideGenerate={true} />
        </div>
      </div>
    </div>
    </FixedLayer>
  );
}

// ─── PACKAGE BUILDER (authoring) ─────────────────────────────────────────────
// The 📦 mode inside Build a Song. Assemble an ordered list of exercises — each
// added by pasting an existing share link OR building a new one in a modal — plus
// an optional tracker, then Save → Supabase → ?pkg= link. Each item stores the
// SAME encoded payload a single share link uses, so nothing about per-exercise
// serialization changes.

// Pull {t, d} out of a pasted share URL or raw encoded string.
function parseShareLink(raw) {
  if(!raw) return null;
  let s = raw.trim();
  const PARAM_TO_TYPE = { drill:"drill", strum:"strum", strumprog:"strumprog", pattern:"pattern" };
  try {
    // Try as a URL with a known param.
    const qIdx = s.indexOf("?");
    if(qIdx >= 0) {
      const params = new URLSearchParams(s.slice(qIdx));
      for(const p of Object.keys(PARAM_TO_TYPE)) {
        if(params.has(p)) return { t: PARAM_TO_TYPE[p], d: params.get(p) };
      }
    }
  } catch(e){}
  return null;
}
// A friendly label for an item, decoded from its payload.
function itemLabel(it) {
  try {
    if(it.t==="drill"){ const d=decodeChordDrill(it.d); return d?.name || (d?.chords||[]).map(slotLabel).join(" ") || "Chords"; }
    if(it.t==="strum"){ const d=decodeStrumDrill(it.d); return d?.name || "Strum pattern"; }
    if(it.t==="strumprog"){ const d=decodeStrumDrill(it.d); return d?.name || "Song (Simple)"; }
    if(it.t==="pattern"){ const d=JSON.parse(atob(it.d)); return d?.n || "Song (Advanced)"; }
  } catch(e){}
  return "Exercise";
}
const PKG_TYPE_META = {
  drill:     { icon:"🤚", label:"Chords",         buildMode:"drill" },
  strum:     { icon:"🎸", label:"Strumming",      buildMode:"strum" },
  strumprog: { icon:"🎵", label:"Song · Simple",  buildMode:"simple" },
  pattern:   { icon:"🎵", label:"Song · Advanced", buildMode:"advanced" },
};

function PackageBuilderTab({ audio, chordVariants, updateVariant }) {
  const [name, setName] = useState("");
  const [day, setDay] = useState(0); // 0 = no day
  const [includeTracker, setIncludeTracker] = useState(false);
  const [anchorAll, setAnchorAll] = useState(true);      // "Allow anchor" — ON shows the ⚓ button for users (default ON)
  const [startAnchored, setStartAnchored] = useState(false); // opens already anchored (implies allow)
  const [items, setItems] = useState([]); // [{ t, d, label }]
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteVal, setPasteVal] = useState("");
  const [buildType, setBuildType] = useState(null); // "drill"|"strum"|"simple"|"advanced" → opens modal
  const [editIdx, setEditIdx] = useState(null);      // index being edited, or null for new
  const [editParam, setEditParam] = useState(null);  // payload to preload into the builder when editing
  const [openSeq, setOpenSeq] = useState(0);          // bumped each modal open → forces builder remount
  const [savedLink, setSavedLink] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  // If the package is changed after a link was generated, that link is now stale
  // (it points to the previously-saved snapshot). Clear it so the user must
  // re-save to get a link reflecting the new content — prevents copying an old link.
  useEffect(() => {
    if(savedLink) setSavedLink(null);
  // eslint-disable-next-line
  }, [name, day, includeTracker, anchorAll, startAnchored, items]);

  const addItem = (it) => setItems(p => [...p, { ...it, label: itemLabel(it) }]);
  const removeItem = (i) => setItems(p => p.filter((_,k)=>k!==i));
  const move = (i, dir) => setItems(p => {
    const j=i+dir; if(j<0||j>=p.length) return p;
    const n=[...p]; [n[i],n[j]]=[n[j],n[i]]; return n;
  });

  const handlePaste = () => {
    const parsed = parseShareLink(pasteVal);
    if(!parsed){ alert("That doesn't look like a Chords / Strum / Song share link. Paste a link that has ?drill= , ?strum= , ?strumprog= or ?pattern= in it."); return; }
    addItem(parsed);
    setPasteVal(""); setPasteOpen(false);
  };

  // Called by the in-modal builder's "Use this in package" button.
  const handleBuilderExport = (t, d, label) => {
    const newItem = { t, d, label: itemLabel({ t, d }) };
    if(editIdx != null){
      setItems(p => p.map((it,i)=> i===editIdx ? newItem : it));
    } else {
      setItems(p => [...p, newItem]);
    }
    setBuildType(null); setEditIdx(null); setEditParam(null);
  };

  // Open an existing item back up in its builder, preloaded with its data.
  const editItem = (i) => {
    const it = items[i];
    if(!it) return;
    const TYPE_TO_BUILD = { drill:"drill", strum:"strum", strumprog:"simple", pattern:"advanced" };
    setEditIdx(i);
    setEditParam(it.d);
    setOpenSeq(s=>s+1);
    setBuildType(TYPE_TO_BUILD[it.t] || null);
  };

  const closeModal = () => { setBuildType(null); setEditIdx(null); setEditParam(null); };

  const doSave = async () => {
    if(items.length < 1 && !includeTracker){ alert("Add at least one exercise (or include the tracker)."); return; }
    setSaving(true); setSaveErr(null); setSavedLink(null);
    try {
      const data = {
        n: name.trim(),
        day: day || null,
        tracker: includeTracker,
        anchor: anchorAll,        // show the ⚓ button to users
        anchorStart: startAnchored, // open already anchored
        items: items.map(it => ({ t: it.t, d: it.d })),
      };
      const id = await packageInsert(data.n, data);
      const url = `${window.location.origin}${window.location.pathname}?pkg=${id}`;
      setSavedLink(url);
      if(navigator.clipboard?.writeText) navigator.clipboard.writeText(url).catch(()=>{});
    } catch(e) {
      console.error(e);
      setSaveErr("Couldn't save the package. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const stepBtn = { width:26, height:26, borderRadius:7, border:"1px solid #333", background:"#1a1a1a",
    color:"#aaa", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" };

  const doReset = () => {
    if(!name.trim() && items.length===0 && !includeTracker && day===0){ return; } // nothing to clear
    if(!window.confirm("Clear this package and start over?")) return;
    setName(""); setDay(0); setIncludeTracker(false); setAnchorAll(true); setStartAnchored(false); setItems([]);
    setPasteOpen(false); setPasteVal(""); setBuildType(null);
    setSavedLink(null); setSaveErr(null);
  };

  return (
    <div style={{ width:"100%" }}>
      <SectionHeader title="📦 Build a Package"
        sub="Bundle a few exercises into one shareable link. Add exercises, set the order, then share."
        action={
          <button onClick={doReset} title="Clear everything and start over"
            style={{ padding:"6px 12px", borderRadius:10,
              border:"1px solid #2a2417", background:"#161009", color:"#8a7f5e",
              fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
            ↺ Reset
          </button>
        } />

      {/* Package details */}
      <div style={{ width:"100%", background:"#0c0a06", border:"1px solid #241d10", borderRadius:18, padding:"16px", marginBottom:14 }}>
        <div style={{ fontSize:10, color:"#5a5238", letterSpacing:2, textTransform:"uppercase", fontWeight:700, marginBottom:12 }}>Package details</div>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Package name — e.g. Day 3 · 30-Day Challenge"
          style={{ width:"100%", padding:"11px 13px", borderRadius:11, border:"1px solid #333", background:"#0a0a0a",
            color:"#fff", fontSize:15, outline:"none", fontFamily:"inherit", marginBottom:14, boxSizing:"border-box" }} />
        <div style={{ display:"flex", alignItems:"center", gap:8, background:"#111", border:"1px solid #241d10", borderRadius:11, padding:"8px 12px" }}>
          <span style={{ fontSize:11, color:"#6f6749", fontWeight:700, letterSpacing:1 }}>CHALLENGE DAY</span>
          <button onClick={()=>setDay(d=>Math.max(0,d-1))} style={stepBtn}>−</button>
          <span style={{ fontSize:16, fontWeight:900, minWidth:24, textAlign:"center", color: day>0?"#FFBE0B":"#444" }}>{day>0?day:"—"}</span>
          <button onClick={()=>setDay(d=>Math.min(30,d+1))} style={stepBtn}>+</button>
          <span style={{ fontSize:11, color:"#5a5238", marginLeft:4 }}>optional</span>
        </div>
      </div>

      {/* Tracker toggle */}
      <div onClick={()=>setIncludeTracker(v=>!v)} style={{ width:"100%", display:"flex", alignItems:"center", gap:12,
        padding:"13px 14px", borderRadius:14, marginBottom:14, cursor:"pointer",
        border:`1px solid ${includeTracker?"rgba(255,190,11,0.45)":"#241d10"}`,
        background: includeTracker ? "radial-gradient(120% 140% at 0% 50%, rgba(255,170,30,0.1) 0%, rgba(255,170,30,0) 60%), #14100a" : "#100d09" }}>
        <div style={{ fontSize:22, width:44, height:44, borderRadius:12, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
          background:"rgba(255,190,11,0.06)", border:"1px solid rgba(255,190,11,0.12)" }}>🔥</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:15, fontWeight:900, color: includeTracker?"#FFD60A":"#f3ead2" }}>30-Day Tracker</div>
          <div style={{ fontSize:11.5, color:"#6f6749", marginTop:2 }}>Pins the streak on top + adds a tracker tab</div>
        </div>
        <div style={{ width:26, height:26, borderRadius:8, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
          border:`2px solid ${includeTracker?"rgba(255,190,11,0.6)":"#2a2417"}`,
          background: includeTracker ? "radial-gradient(130% 130% at 50% 0%, rgba(255,190,11,0.22), rgba(255,140,0,0.12)), #16110a" : "#0e0b06" }}>
          {includeTracker && <div style={{ width:9, height:5, borderLeft:"2px solid #FFD60A", borderBottom:"2px solid #FFD60A", transform:"rotate(-45deg) translate(1px,-1px)" }} />}
        </div>
      </div>

      {/* Anchor controls — one compact row. "Allow" shows the ⚓ button to users;
          "Start anchored" opens already anchored (and forces Allow on). Turning
          Allow off also clears Start anchored. */}
      <div style={{ width:"100%", display:"flex", alignItems:"center", gap:12,
        padding:"12px 14px", borderRadius:14, marginBottom:14,
        border:`1px solid ${anchorAll?"rgba(255,190,11,0.45)":"#241d10"}`,
        background: anchorAll ? "radial-gradient(120% 140% at 0% 50%, rgba(255,170,30,0.1) 0%, rgba(255,170,30,0) 60%), #14100a" : "#100d09" }}>
        <div style={{ fontSize:22, width:40, height:40, borderRadius:11, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
          background:"rgba(255,190,11,0.06)", border:"1px solid rgba(255,190,11,0.12)" }}>⚓</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14.5, fontWeight:900, color: anchorAll?"#FFD60A":"#f3ead2" }}>Anchor chords</div>
          <div style={{ fontSize:11, color:"#6f6749", marginTop:2 }}>G, C, Em, D anchored shapes</div>
        </div>
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
          {(() => {
            const pill = (on) => ({
              padding:"7px 11px", borderRadius:10, fontSize:11.5, fontWeight:800, cursor:"pointer",
              border:`1px solid ${on?"rgba(255,190,11,0.6)":"#2a2417"}`,
              background: on ? "radial-gradient(130% 130% at 50% 0%, rgba(255,190,11,0.22), rgba(255,140,0,0.12)), #16110a" : "#0e0b06",
              color: on ? "#FFD60A" : "#6f6749", whiteSpace:"nowrap", userSelect:"none",
            });
            return (<>
              <div onClick={()=>{ const nv=!anchorAll; setAnchorAll(nv); if(!nv) setStartAnchored(false); }} style={pill(anchorAll)}>
                {anchorAll ? "✓ Allow" : "Allow"}
              </div>
              <div onClick={()=>{ const nv=!startAnchored; setStartAnchored(nv); if(nv) setAnchorAll(true); }} style={pill(startAnchored)}>
                {startAnchored ? "✓ Start on" : "Start on"}
              </div>
            </>);
          })()}
        </div>
      </div>

      {/* Items list */}
      <div style={{ width:"100%", background:"#0c0a06", border:"1px solid #241d10", borderRadius:18, padding:"16px", marginBottom:14 }}>
        <div style={{ fontSize:10, color:"#5a5238", letterSpacing:2, textTransform:"uppercase", fontWeight:700, marginBottom:12 }}>Exercises &amp; order</div>

        {items.length===0 && (
          <div style={{ textAlign:"center", color:"#5a5238", fontSize:12, padding:"10px 0 16px" }}>
            No exercises yet — paste a link or build one below.
          </div>
        )}

        {items.map((it,i)=>(
          <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 12px", borderRadius:13,
            border:"1px solid #241d10", background:"#100d09", marginBottom:9 }}>
            <span style={{ width:22, height:22, borderRadius:7, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
              background:"rgba(255,190,11,0.12)", border:"1px solid rgba(255,190,11,0.3)", color:"#FFBE0B", fontSize:11, fontWeight:900 }}>{i+1}</span>
            <span style={{ fontSize:18, flexShrink:0 }}>{PKG_TYPE_META[it.t]?.icon||"🎵"}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:900, color:"#f3ead2", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{it.label}</div>
              <div style={{ fontSize:10.5, color:"#6f6749" }}>{PKG_TYPE_META[it.t]?.label||it.t}</div>
            </div>
            <div style={{ display:"flex", gap:5, flexShrink:0 }}>
              <button onClick={()=>editItem(i)} title="Edit" style={{ ...stepBtn, color:"#FFBE0B", borderColor:"rgba(255,190,11,0.35)", background:"#16110a" }}>✏️</button>
              <button onClick={()=>move(i,-1)} disabled={i===0} style={{ ...stepBtn, opacity:i===0?0.3:1 }}>↑</button>
              <button onClick={()=>move(i,1)} disabled={i===items.length-1} style={{ ...stepBtn, opacity:i===items.length-1?0.3:1 }}>↓</button>
              <button onClick={()=>removeItem(i)} style={{ ...stepBtn, color:"#e74c3c88", borderColor:"#3a1a1a", background:"#1a0a0a" }}>✕</button>
            </div>
          </div>
        ))}

        {/* Add controls */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:6 }}>
          <button onClick={()=>setPasteOpen(o=>!o)} style={{ flex:1, minWidth:130, padding:"10px", borderRadius:11,
            border:"1px solid #241d10", background:"#100d09", color:"#8a7f5e", fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
            🔗 Paste a link
          </button>
        </div>
        {pasteOpen && (
          <div style={{ marginTop:8, background:"#111", border:"1px solid #FFBE0B33", borderRadius:12, padding:"12px" }}>
            <div style={{ fontSize:11, color:"#888", marginBottom:8 }}>Paste a Chords / Strum / Song share link</div>
            <div style={{ display:"flex", gap:8 }}>
              <input value={pasteVal} onChange={e=>setPasteVal(e.target.value)} placeholder="https://practice.notheoryclub.com/?drill=…"
                style={{ flex:1, padding:"9px 12px", borderRadius:10, border:"1px solid #333", background:"#0a0a0a", color:"#fff", fontSize:12, outline:"none", fontFamily:"monospace" }} />
              <button onClick={handlePaste} style={{ padding:"9px 16px", borderRadius:10, border:"none",
                background:"linear-gradient(135deg,#FFBE0B,#F77F00)", color:"#111", fontSize:13, fontWeight:800, cursor:"pointer" }}>Add</button>
            </div>
          </div>
        )}

        {/* Build new */}
        <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #1a160d" }}>
          <div style={{ fontSize:10, color:"#5a5238", letterSpacing:1, marginBottom:8 }}>OR BUILD A NEW ONE</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {[["drill","🤚 Chords"],["strum","🎸 Strum"],["simple","🎵 Song · Simple"],["advanced","🎵 Song · Advanced"]].map(([t,lbl])=>(
              <button key={t} onClick={()=>{ setEditIdx(null); setEditParam(null); setOpenSeq(s=>s+1); setBuildType(t); }} style={{ flex:"1 1 auto", padding:"9px 12px", borderRadius:10,
                border:"1px dashed rgba(255,190,11,0.4)", background:"rgba(255,190,11,0.06)", color:"#FFBE0B",
                fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Save */}
      <button onClick={doSave} disabled={saving} style={{ width:"100%", padding:"14px", borderRadius:14,
        border:"1px solid rgba(255,190,11,0.5)", cursor:saving?"wait":"pointer", fontFamily:"inherit",
        background:"radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.2) 0%, rgba(255,170,30,0) 70%), #16110a",
        color:"#FFD60A", fontSize:16, fontWeight:900, letterSpacing:0.5, boxShadow:"0 0 22px rgba(255,160,20,0.22)", marginBottom:14 }}>
        {saving ? "Saving…" : "🔗 Save & generate link"}
      </button>

      {saveErr && <div style={{ color:"#ff8a7a", fontSize:13, textAlign:"center", marginBottom:14 }}>{saveErr}</div>}

      {savedLink && (
        <div style={{ border:"1px solid rgba(255,190,11,0.35)", borderRadius:16, padding:"16px", marginBottom:14,
          background:"radial-gradient(130% 130% at 50% 0%, rgba(255,170,30,0.08) 0%, rgba(255,170,30,0) 60%), #100d09" }}>
          <div style={{ fontSize:13, fontWeight:900, color:"#FFD60A", textAlign:"center", marginBottom:10 }}>✅ Package link ready (copied)</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ flex:1, padding:"10px 12px", borderRadius:10, background:"#0a0a0a", border:"1px solid #333",
              color:"#6b9fff", fontSize:12, fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{savedLink}</div>
            <button onClick={()=>{ navigator.clipboard?.writeText(savedLink).then(()=>alert("✅ Copied!")).catch(()=>prompt("Copy:",savedLink)); }}
              style={{ padding:"10px 16px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#FFBE0B,#F77F00)", color:"#111", fontSize:13, fontWeight:800, cursor:"pointer" }}>Copy</button>
          </div>
        </div>
      )}

      {/* Build-new modal */}
      {buildType && (
        <div style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.9)", backdropFilter:"blur(6px)",
          overflowY:"auto", padding:"12px" }}>
          <div style={{ maxWidth:560, margin:"0 auto", background:"#0d0d0a", border:"1px solid #241d10", borderRadius:18, padding:"14px 12px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ fontSize:13, fontWeight:900, color:"#FFD60A" }}>
                {editIdx!=null ? "Edit" : "Build"} {PKG_TYPE_META[buildType==="simple"?"strumprog":buildType==="advanced"?"pattern":buildType]?.label || buildType}
              </div>
              <button onClick={closeModal} style={{ background:"none", border:"none", color:"#888", fontSize:20, cursor:"pointer" }}>✕</button>
            </div>
            {buildType==="drill" && <ChordsTab key={`drill-${openSeq}`} audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} onExport={handleBuilderExport} initialParam={editParam} />}
            {buildType==="strum" && <StrummingTab key={`strum-${openSeq}`} audio={audio} onExport={handleBuilderExport} initialParam={editParam} />}
            {buildType==="simple" && <SimpleBuildSong key={`simple-${openSeq}`} audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} onExport={handleBuilderExport} initialParam={editParam} />}
            {buildType==="advanced" && <AdvancedBuildSong key={`advanced-${openSeq}`} audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} onExport={handleBuilderExport} initialParam={editParam} />}
          </div>
        </div>
      )}

      <div style={{ textAlign:"center", paddingTop:8, paddingBottom:8, color:"#332e22", fontSize:11 }}>
        © {new Date().getFullYear()} No Theory Club · All rights reserved.
      </div>
    </div>
  );
}

// ─── PACKAGE SHARE VIEW ──────────────────────────────────────────────────────
// Renders a ?pkg= link: fetches the package row, decodes each item with the
// EXISTING per-type decoders, and shows the combined bottom-nav view (with an
// optional pinned streak strip + tracker tab). Step 1 = stub: fetch + states
// only. The panel renderers and nav are added in step 2.
function PackageShareView({ audio, chordVariants, updateVariant }) {
  const [status, setStatus] = useState("loading"); // "loading" | "ready" | "error" | "notfound"
  const [pkg, setPkg] = useState(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("pkg");
    if(!id){ setStatus("notfound"); return; }
    let cancelled = false;
    packageFetch(id)
      .then(row => {
        if(cancelled) return;
        if(!row){ setStatus("notfound"); return; }
        setPkg(row.data || null);
        setStatus("ready");
        // Keep the ?pkg= param in the URL so a refresh reloads this package
        // instead of dropping the member back to the home page.
      })
      .catch(err => {
        if(cancelled) return;
        console.error("Package load failed:", err);
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, []);

  const shell = (children) => (
    <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px", textAlign:"center" }}>
      <style>{NTC_SLIDER_CSS}</style>
      {children}
    </div>
  );

  if(status === "loading") return shell(
    <>
      <div style={{ fontSize:12, fontWeight:700, color:"#fff", letterSpacing:1.5, marginBottom:6 }}>NO THEORY CLUB</div>
      <div style={{ fontSize:32, marginBottom:14 }}>📦</div>
      <div style={{ fontSize:15, fontWeight:800, color:"#FFD60A", marginBottom:6 }}>Loading package…</div>
      <div style={{ fontSize:12, color:"#8a7f5e", maxWidth:300, lineHeight:1.6 }}>
        Fetching your exercises. If this is the first open after a while, it can take a moment to wake up.
      </div>
    </>
  );

  if(status === "error" || status === "notfound") return shell(
    <>
      <div style={{ fontSize:12, fontWeight:700, color:"#fff", letterSpacing:1.5, marginBottom:6 }}>NO THEORY CLUB</div>
      <div style={{ fontSize:32, marginBottom:14 }}>🎸</div>
      <div style={{ fontSize:18, fontWeight:900, color:"#fff", marginBottom:8 }}>
        {status === "notfound" ? "Package not found" : "Couldn't load this package"}
      </div>
      <div style={{ fontSize:13, color:"#888", lineHeight:1.6, maxWidth:320, marginBottom:20 }}>
        {status === "notfound"
          ? "This link may be broken or the package was removed."
          : "Something went wrong reaching the server. Reloading usually fixes it."}
      </div>
      <button onClick={()=>window.location.reload()}
        style={{ padding:"11px 22px", borderRadius:12, border:"none",
          background:"linear-gradient(135deg,#FFD60A,#F77F00)",
          color:"#111", fontSize:14, fontWeight:800, cursor:"pointer" }}>
        Try again
      </button>
    </>
  );

  // status === "ready" — the combined bottom-nav view.
  return <PackageView pkg={pkg} audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} />;
}

// The combined practice view: a pinned streak strip (when the package includes
// the tracker), a panel per exercise rendered via the EXISTING share components
// (fed package data through initialParam), and a bottom nav. Built to match the
// approved mockup (Option B).
function PackageView({ pkg, audio, chordVariants, updateVariant }) {
  const items = Array.isArray(pkg?.items) ? pkg.items : [];
  const hasTracker = !!pkg?.tracker;

  // "Anchor chords" toggle: each exercise panel applies the swap live via the
  // `anchored` prop (G/C/Em/D → anchored shapes), so it stays mounted and the
  // page doesn't reflow when toggled.
  // The anchor button shows by DEFAULT (every existing package keeps it). An
  // author hides it with anchor:false. Separately, anchorStart:true opens the
  // package already anchored. Older links have neither extra flag → button shown,
  // starts on open chords (unchanged).
  const allowAnchor = pkg?.anchor !== false;
  const [anchored, setAnchored] = useState(!!pkg?.anchorStart && allowAnchor);

  // Build the ordered list of tabs: each exercise item, then tracker (if on).
  const TYPE_META = {
    drill:     { icon:"🤚", label:"Chords" },
    strum:     { icon:"🎸", label:"Strum" },
    strumprog: { icon:"🎵", label:"Song" },
    pattern:   { icon:"🎵", label:"Song" },
  };
  const tabs = items.map((it, i) => ({
    key: "item"+i,
    icon: TYPE_META[it.t]?.icon || "🎵",
    label: TYPE_META[it.t]?.label || "Drill",
    item: it,
  }));
  if(hasTracker) tabs.push({ key:"tracker", icon:"🔥", label:"Tracker", item:null });

  const [activeKey, setActiveKey] = useState(tabs[0]?.key || "tracker");
  const activeIdx = tabs.findIndex(t => t.key === activeKey);

  // Streak for the pinned strip (reads the tracker's own storage).
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    if(!hasTracker) return;
    try {
      const saved = localStorage.getItem(TRACKER_STORAGE_KEY);
      if(saved) setStreak(trackerStreak(JSON.parse(saved)));
    } catch(_){}
  }, [hasTracker]);

  // Render a single exercise item via its existing share component.
  const renderItem = (it) => {
    if(!it) return null;
    const name = (pkg?.n || "").trim();
    const title = name ? (
      <div style={{ width:"100%", textAlign:"center", marginBottom:12 }}>
        <div style={{ fontSize:22, fontWeight:900, color:"#fff", letterSpacing:0.3,
          textShadow:"0 2px 8px rgba(0,0,0,0.5)" }}>{name}</div>
      </div>
    ) : null;
    let panel = null;
    if(it.t === "drill")
      panel = <ChordsTab audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} sharedView={true} initialParam={it.d} hideTitle={true} anchored={anchored} />;
    else if(it.t === "strum")
      panel = <StrummingTab audio={audio} sharedView={true} initialParam={it.d} hideTitle={true} anchored={anchored} />;
    else if(it.t === "strumprog")
      panel = <BuildSongTab audio={audio} initialBuildMode="simple" chordVariants={chordVariants} updateVariant={updateVariant} sharedView={true} initialParam={it.d} hideTitle={true} anchored={anchored} />;
    else if(it.t === "pattern")
      panel = <BuildSongTab audio={audio} initialBuildMode="advanced" chordVariants={chordVariants} updateVariant={updateVariant} sharedView={true} initialParam={it.d} hideTitle={true} anchored={anchored} />;
    return <>{title}{panel}</>;
  };

  // Guided next/prev (drills walk forward, ending on tracker if present).
  const go = (key) => {
    try { window.dispatchEvent(new Event("ntc-stop-playback")); } catch(e){}
    setActiveKey(key);
    window.scrollTo(0,0);
  };

  return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff" }}>
      <style>{NTC_SLIDER_CSS}</style>
      <style>{`@keyframes ntcPkgFade { from { opacity:0; } to { opacity:1; } }`}</style>

      {/* Centered column — matches the rest of the app's max width. Bottom padding
          leaves room for the fixed nav so content never hides behind it. */}
      <div style={{ maxWidth:560, margin:"0 auto", paddingBottom: tabs.length > 1 ? 96 : 24 }}>

      {/* Brand header */}
      <div style={{ textAlign:"center", padding:"14px 16px 8px", flexShrink:0 }}>
        <div style={{ fontSize:16, fontWeight:900, letterSpacing:1.5,
          background:"linear-gradient(135deg,#FFE27A,#FFBE0B 50%,#F77F00)",
          WebkitBackgroundClip:"text", backgroundClip:"text", WebkitTextFillColor:"transparent" }}>NO THEORY CLUB</div>
        <div style={{ fontSize:9, color:"#6f6749", letterSpacing:2, marginTop:2, textTransform:"uppercase" }}>
          Shared Practice{pkg?.day ? ` · Day ${pkg.day}` : ""}
        </div>
      </div>

      {/* Pinned streak strip (only when tracker is included) — tap to open Tracker */}
      {hasTracker && (
        <div onClick={()=>go("tracker")} role="button" tabIndex={0}
          onKeyDown={e=>{ if(e.key==="Enter"||e.key===" ") go("tracker"); }}
          style={{ margin:"4px 14px 0", flexShrink:0, cursor:"pointer",
          border:`1px solid ${activeKey==="tracker"?"rgba(255,190,11,0.5)":"rgba(255,190,11,0.25)"}`, borderRadius:14,
          background:"radial-gradient(130% 130% at 0% 50%, rgba(255,170,30,0.10) 0%, rgba(255,170,30,0) 60%), #100d09",
          padding:"13px 16px", display:"flex", alignItems:"center", gap:13, transition:"border-color 0.2s" }}>
          <div style={{ width:48, height:48, borderRadius:12, flexShrink:0, display:"flex",
            flexDirection:"column", alignItems:"center", justifyContent:"center",
            background:"rgba(255,190,11,0.1)", border:"1px solid rgba(255,190,11,0.35)" }}>
            <span style={{ fontSize:22, fontWeight:900, color:"#FFBE0B", lineHeight:1 }}>{streak}</span>
            <span style={{ fontSize:8, color:"#6f6749", letterSpacing:1, marginTop:1 }}>DAYS</span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:16, fontWeight:900, color:"#f3ead2", lineHeight:1.2 }}>
              {pkg?.day ? `Day ${pkg.day} of 30 — keep the streak 🔥` : "Keep the streak 🔥"}
            </div>
            <div style={{ fontSize:12, color:"#8a7f5e", marginTop:3, fontWeight:600 }}>
              Tap to open your tracker
            </div>
          </div>
          <div style={{ color:"#FFBE0B", fontSize:22, flexShrink:0, fontWeight:900 }}>›</div>
        </div>
      )}

      {/* Anchor-chords toggle — swaps G/C/Em/D to their anchored voicings across
          all exercises. Hidden on the tracker tab (no chords there). */}
      {allowAnchor && activeKey !== "tracker" && (
        <div style={{ padding:"6px 16px 0", display:"flex", justifyContent:"center" }}>
          <button onClick={()=>{ try{ window.dispatchEvent(new Event("ntc-stop-playback")); }catch(e){} setAnchored(a=>!a); }}
            title="Switch G, C, Em and D to their anchored shapes"
            style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
              borderRadius:12, padding:"9px 16px", fontSize:13, fontWeight:800, letterSpacing:0.3,
              border: anchored ? "1px solid #FFBE0B" : "1px solid #2a2a2a",
              background: anchored ? "rgba(255,190,11,0.13)" : "#141414",
              color: anchored ? "#FFBE0B" : "#888",
              boxShadow: anchored ? "0 0 12px rgba(255,190,11,0.25)" : "none", transition:"all 0.15s" }}>
            ⚓ {anchored ? "Anchored chords ON" : "Anchor chords"}
          </button>
        </div>
      )}

      {/* Active panel — kept mounted via display toggle so playback state survives
          tab switches; each panel fades in on activation. */}
      <div style={{ padding:"4px 16px 8px" }}>
        {tabs.map(t => (
          <div key={t.key}
            style={{ display: t.key===activeKey ? "block" : "none",
              animation: t.key===activeKey ? "ntcPkgFade 0.35s ease both" : "none" }}>
            {t.key==="tracker" ? <TrackerTab context="package" /> : renderItem(t.item)}
          </div>
        ))}

        {/* Guided footer — Back / Next through the items (skips on tracker) */}
        {activeKey !== "tracker" && tabs.length > 1 && (
          <div style={{ display:"flex", gap:8, marginTop:6 }}>
            {activeIdx > 0 && (
              <button onClick={()=>go(tabs[activeIdx-1].key)} style={{
                flex:"0 0 90px", padding:"11px", borderRadius:12,
                border:"1px solid #241d10", background:"#100d09", color:"#8a7f5e",
                fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>← Back</button>
            )}
            <button onClick={()=>go(tabs[activeIdx+1].key)} style={{
              flex:1, padding:"11px", borderRadius:12,
              border:"1px solid rgba(255,190,11,0.35)",
              background:"radial-gradient(120% 160% at 50% 0%, rgba(255,170,30,0.12) 0%, rgba(255,170,30,0) 70%), #14100a",
              color:"#FFD60A", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
              {tabs[activeIdx+1]?.key==="tracker" ? "Finish → Tracker" : "Next →"}
            </button>
          </div>
        )}
      </div>

      </div>{/* end centered column */}

      {/* Exercise Generator — opened by the launcher on the package tracker */}
      <ExerciseGeneratorHost audio={audio} chordVariants={chordVariants} updateVariant={updateVariant} context="package" />

      {/* Bottom nav — fixed to the screen, centered to the same column width.
          Hidden when there's only one tab (single-exercise package): a one-button
          switcher serves no purpose and looks unfinished. */}
      {tabs.length > 1 && (
      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:200,
        background:"linear-gradient(0deg, rgba(13,11,8,0.98) 0%, rgba(13,11,8,0.92) 70%, rgba(13,11,8,0) 100%)",
        backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)",
        borderTop:"1px solid #1c1710" }}>
        <div style={{ maxWidth:560, margin:"0 auto", display:"flex", gap:4, padding:"8px 10px 14px" }}>
          {tabs.map(t => {
            const on = t.key===activeKey;
            return (
              <button key={t.key} onClick={()=>go(t.key)} style={{
                flex:1, padding:"8px 2px", borderRadius:13, cursor:"pointer", fontFamily:"inherit",
                border:`1px solid ${on ? "rgba(255,190,11,0.4)" : "transparent"}`,
                background: on
                  ? "radial-gradient(120% 160% at 50% 100%, rgba(255,170,30,0.16) 0%, rgba(255,170,30,0) 65%), #16110a"
                  : "transparent",
                color: on ? "#FFD60A" : "#5a5238",
                display:"flex", flexDirection:"column", alignItems:"center", gap:3, transition:"all 0.2s" }}>
                <span style={{ fontSize:19 }}>{t.icon}</span>
                <span style={{ fontSize:9, fontWeight:800, letterSpacing:0.3 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}

// ─── LANDING SCREEN ──────────────────────────────────────────────────────────
// Clean title screen shown on a fresh visit (no shared exercise URL). The four
// cards navigate to each tab. Fade-in + warm-glow dark buttons.
function LandingScreen({ onPick, streak, isDev = false, onDev = null }) {
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
    { id:"song",    icon:"🎵", title:"Build a Song",    sub:"Your chords + strumming, played back" },
  ];

  const [hover, setHover] = useState(null);

  return (
    <div style={{ minHeight:"100dvh",
      background:"radial-gradient(ellipse at top, #1a1208 0%, #0d0d0a 60%)",
      fontFamily:"'Trebuchet MS', sans-serif", color:"#fff",
      display:"flex", flexDirection:"column", alignItems:"center" }}>
      <div style={{ width:"100%", maxWidth:480, padding:"0 22px 20px",
        display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}>

        {/* Hero */}
        <div style={{ textAlign:"center", padding:"34px 0 10px", ...rise(0) }}>
          <span style={{ display:"inline-block", fontSize:11, letterSpacing:4,
            color:"#7a6a3a", fontWeight:700, marginBottom:16, textTransform:"uppercase" }}>
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
            background:"linear-gradient(90deg,#FFD60A,#F77F00)", margin:"16px auto 0", opacity:0.85 }} />
        </div>

        <div style={{ margin:"16px 0 14px", fontSize:13, color:"#6f6749", fontWeight:700,
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

        {/* Progress Tracker — set apart, with a breathing outline glow. The glow
            is an absolutely-positioned layer animated on OPACITY only, so it
            stays compositor-friendly (no per-frame paint of the card itself). */}
        <div style={{ width:"100%", marginTop:22, ...rise(0.52) }}>
          <style>{`@keyframes ntcTrackerGlow { 0%, 100% { opacity:0.3; } 50% { opacity:1; } }`}</style>
          <button
            onClick={()=>onPick("tracker")}
            onMouseEnter={()=>setHover("tracker")}
            onMouseLeave={()=>setHover(null)}
            style={{
              position:"relative", width:"100%",
              border:`1px solid ${hover==="tracker" ? "rgba(255,190,11,0.65)" : "rgba(255,190,11,0.4)"}`,
              borderRadius:18, padding:"20px", cursor:"pointer", textAlign:"left",
              display:"flex", alignItems:"center", gap:16, color:"#fff", fontFamily:"inherit",
              background:"radial-gradient(120% 140% at 0% 50%, rgba(255,170,30,0.12) 0%, rgba(255,170,30,0) 60%), #120e08",
              boxShadow:"0 6px 22px rgba(0,0,0,0.45)",
              transform: hover==="tracker" ? "translateY(-2px)" : "translateY(0)",
              transition:"transform 0.18s ease, border-color 0.25s ease",
            }}>
            <span aria-hidden="true" style={{ position:"absolute", inset:-1, borderRadius:18,
              pointerEvents:"none", boxShadow:"0 0 26px rgba(255,170,20,0.5), inset 0 0 14px rgba(255,170,20,0.12)",
              animation:"ntcTrackerGlow 2.8s ease-in-out infinite" }} />
            <span style={{ fontSize:26, width:48, height:48, borderRadius:14,
              display:"flex", alignItems:"center", justifyContent:"center",
              background:"rgba(255,190,11,0.1)", border:"1px solid rgba(255,190,11,0.25)",
              flexShrink:0 }}>🔥</span>
            <span style={{ display:"flex", flexDirection:"column", gap:3 }}>
              <span style={{ fontSize:18, fontWeight:900, letterSpacing:0.2, color:"#FFD60A" }}>Progress Tracker</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#9a8d6a" }}>Build the habit, keep your streak</span>
            </span>
            <span style={{ marginLeft:"auto", display:"flex", flexDirection:"column", alignItems:"center",
              background:"rgba(255,190,11,0.1)", border:"1px solid rgba(255,190,11,0.35)",
              borderRadius:11, padding:"5px 11px", marginRight:6 }}>
              <span style={{ fontSize:18, fontWeight:900, color:"#FFBE0B", lineHeight:1 }}>{streak||0}</span>
              <span style={{ fontSize:8, color:"#776b4d", letterSpacing:1, marginTop:2 }}>DAYS</span>
            </span>
          </button>
        </div>

        {/* Founder-only: legacy authoring suite */}
        {isDev && onDev && (
          <div style={{ width:"100%", marginTop:18, textAlign:"center", ...rise(0.6) }}>
            <button onClick={onDev} style={{ padding:"8px 18px", borderRadius:10,
              border:"1px solid #241d10", background:"transparent", color:"#5a5238",
              fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", letterSpacing:1 }}>
              🛠 Dev tools →
            </button>
          </div>
        )}

        <div style={{ marginTop:"auto", paddingTop:20, fontSize:11, color:"#332e22",
          textAlign:"center", ...rise(0.7) }}>
          © {new Date().getFullYear()} No Theory Club · All rights reserved.
        </div>
      </div>
    </div>
  );
}

// ─── DEFAULT EXPORT — App wrapped in access gate + error boundary ─────────────
export default function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <AccessGate>
        <App />
      </AccessGate>
    </ErrorBoundary>
  );
}
