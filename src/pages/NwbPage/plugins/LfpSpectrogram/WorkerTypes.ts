export type SpectrogramInput = {
  // The signal for a single channel, already in physical units.
  signal: number[];
  samplingFrequency: number;
  // Time (in seconds) corresponding to signal[0].
  signalStartTimeSec: number;
  // FFT window length in number of samples (should be a power of two).
  windowSize: number;
  // Fraction of overlap between consecutive windows in [0, 1).
  overlap: number;
};

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
