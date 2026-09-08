import { SpectralConfig } from "./spectralConfig";

// Opt-in presets. Selecting one populates the controls and leaves every field
// editable; nothing auto-applies and nothing is auto-detected from the data.

export type Preset = {
  id: string;
  name: string;
  description: string;
  apply: (
    base: SpectralConfig,
    fsNative: number,
    nyquistHz: number,
  ) => SpectralConfig;
};

const nearestPow2 = (n: number): number => {
  if (n <= 1) return 1;
  const lo = Math.pow(2, Math.floor(Math.log2(n)));
  const hi = lo * 2;
  return n - lo < hi - n ? lo : hi;
};

const windowForSeconds = (t: number, fs: number): number =>
  Math.max(64, Math.min(8192, nearestPow2(t * fs)));

export const PRESETS: Preset[] = [
  {
    id: "rodent-theta",
    name: "Rodent LFP — theta/harmonics",
    description:
      "Long (~2 s) Hann window, 1–30 Hz. Theta is non-sinusoidal: its harmonics near 16 and 24 Hz are real signal, so heavy multitaper smoothing would destroy them — this keeps single-taper resolution.",
    apply: (base, fs, nyq) => ({
      ...base,
      taper: "hann",
      windowSizeSamples: windowForSeconds(2, fs),
      overlap: 0.5,
      fMinHz: 1,
      fMaxHz: Math.min(30, nyq),
      logFreq: false,
    }),
  },
  {
    id: "rodent-gamma",
    name: "Rodent LFP — gamma",
    description:
      "~0.5 s multitaper (NW 3), 20–120 Hz. Broadband target.",
    apply: (base, fs, nyq) => ({
      ...base,
      taper: "multitaper",
      nw: 3,
      k: 5,
      windowSizeSamples: windowForSeconds(0.5, fs),
      overlap: 0.5,
      fMinHz: 20,
      fMaxHz: Math.min(120, nyq),
      logFreq: false,
    }),
  },
  {
    id: "rodent-swr",
    name: "Rodent LFP — sharp-wave ripples",
    description:
      "Morlet wavelets (not multitaper), ~100–250 Hz. Ripples are 50–100 ms at 140–200 Hz; at T=0.1 s even NW=2 gives W=20 Hz, which erases the structure — so wavelets by default.",
    apply: (base, fs, nyq) => ({
      ...base,
      taper: "morlet",
      waveletCycles: 7,
      windowSizeSamples: windowForSeconds(0.25, fs),
      fMinHz: 100,
      fMaxHz: Math.min(250, nyq),
      logFreq: false,
    }),
  },
  {
    id: "human-eeg-low",
    name: "Human EEG — low frequency",
    description:
      "Hann, ~1 s window, 1–30 Hz. Fixed-Hz smoothing is proportionally destructive at alpha, so resolution is kept.",
    apply: (base, fs, nyq) => ({
      ...base,
      taper: "hann",
      windowSizeSamples: windowForSeconds(1, fs),
      overlap: 0.5,
      fMinHz: 1,
      fMaxHz: Math.min(30, nyq),
      logFreq: false,
    }),
  },
  {
    id: "human-eeg-gamma",
    name: "Human EEG — gamma / broadband",
    description:
      "DPSS multitaper above ~30 Hz. Note scalp gamma is frequently EMG and broadband; treat sharp 'peaks' skeptically.",
    apply: (base, fs, nyq) => ({
      ...base,
      taper: "multitaper",
      nw: 4,
      k: 7,
      windowSizeSamples: windowForSeconds(0.5, fs),
      overlap: 0.5,
      fMinHz: 30,
      fMaxHz: Math.min(100, nyq),
      logFreq: false,
    }),
  },
];
