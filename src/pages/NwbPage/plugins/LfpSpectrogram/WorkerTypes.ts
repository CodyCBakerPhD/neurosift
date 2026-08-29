export type SpectrogramInput = {
  // One signal per selected channel, already in physical units and all the
  // same length. When more than one is given, the power is averaged across
  // them (mean power spectrogram).
  signals: number[][];
  samplingFrequency: number;
  // Time (in seconds) corresponding to signal[0].
  signalStartTimeSec: number;
  // FFT window length in number of samples (should be a power of two).
  windowSize: number;
  // Desired number of output time columns for this block. The STFT is computed
  // at a fixed fine analysis step over all samples and power is averaged into
  // this many columns — the averaging anti-aliases the time axis before the
  // columns are decimated to the display resolution.
  targetColumns: number;
};

// dB power spectral density, one value per (window, frequency) bin. Values are
// the raw per-window power (no display normalization/filtering — those are
// applied at render time).
export type SpectrogramResult = {
  // Row-major matrix of size numWindows x numFreqs holding power in dB.
  powers: number[];
  numWindows: number;
  numFreqs: number;
  // Center time (seconds) of the first window.
  firstWindowCenterTimeSec: number;
  // Time step (seconds) between consecutive windows.
  windowStepSec: number;
  // Frequency (Hz) of the first bin and spacing between bins.
  freqStartHz: number;
  freqStepHz: number;
  minPowerDb: number;
  maxPowerDb: number;
};
