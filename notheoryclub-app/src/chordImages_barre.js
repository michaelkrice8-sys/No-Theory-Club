// Barre chord diagrams.
//
// URLs into public/chords/, not inlined base64 like the other chord image
// files. 25 diagrams inlined would have added ~3 MB to a bundle already at
// 3.5 MB, and every visitor would download all of them whether or not they
// ever opened the barre section. As files they are fetched only when a barre
// chord is shown, then cached. An <img src> treats a URL and a data: URI
// identically, so nothing that renders a chord needed to change.
//
// PNG, copied byte-for-byte from the source export, because these have a
// TRANSPARENT background. The older chord images are JPEG flattened onto
// black, which only looks transparent because the app background is nearly
// black; these are actually transparent and sit correctly on any backdrop.
// Do not "optimise" them through sips — it flattens the alpha onto WHITE and
// leaves a white card around every diagram.
//
// Filenames use "s" for sharp: a literal "#" in a URL starts the fragment, so
// /chords/F#_barre.png would request /chords/F and never reach the file.
export const CHORD_IMAGES_BARRE = {
  "F_barre": "/chords/F_barre.png",
  "F#_barre": "/chords/Fs_barre.png",
  "G_barre": "/chords/G_barre.png",
  "G#_barre": "/chords/Gs_barre.png",
  "A_barre": "/chords/A_barre.png",
  "A#_barre": "/chords/As_barre.png",
  "Bb_barre": "/chords/Bb_barre.png",
  "B_barre": "/chords/B_barre.png",
  "C_barre": "/chords/C_barre.png",
  "C#_barre": "/chords/Cs_barre.png",
  "D_barre": "/chords/D_barre.png",
  "D#_barre": "/chords/Ds_barre.png",
  "E_barre": "/chords/E_barre.png",
  "Fm_barre": "/chords/Fm_barre.png",
  "F#m_barre": "/chords/Fsm_barre.png",
  "Gm_barre": "/chords/Gm_barre.png",
  "G#m_barre": "/chords/Gsm_barre.png",
  "Am_barre": "/chords/Am_barre.png",
  "A#m_barre": "/chords/Asm_barre.png",
  "Bbm_barre": "/chords/Bbm_barre.png",
  "Bm_barre": "/chords/Bm_barre.png",
  "Cm_barre": "/chords/Cm_barre.png",
  "C#m_barre": "/chords/Csm_barre.png",
  "Dm_barre": "/chords/Dm_barre.png",
  "D#m_barre": "/chords/Dsm_barre.png",
  "Em_barre": "/chords/Em_barre.png",
};
