import { FunctionComponent, useEffect, useMemo, useRef } from "react";
import { applyColormap, ColormapName } from "./colormap";
import { plotMargins } from "./plotConstants";
import { SpectrogramResult } from "./WorkerTypes";

type Props = {
  // The computed spectrogram block (covers a range at least as wide as the
  // visible window). May be null while the first block is loading.
  result: SpectrogramResult | null;
  width: number;
  height: number;
  colormap: ColormapName;
  // Visible time window (seconds); columns are positioned by absolute time so
  // panning/zooming is just a redraw of the cached block.
  visibleStartTimeSec: number;
  visibleEndTimeSec: number;
  // Displayed frequency range (Hz).
  freqMinHz: number;
  freqMaxHz: number;
  // Power range (dB) mapped to the colormap; if undefined the data range is used.
  powerMinDb?: number;
  powerMaxDb?: number;
  loading?: boolean;
};

const margins = plotMargins;

const SpectrogramWidget: FunctionComponent<Props> = ({
  result,
  width,
  height,
  colormap,
  visibleStartTimeSec,
  visibleEndTimeSec,
  freqMinHz,
  freqMaxHz,
  powerMinDb,
  powerMaxDb,
  loading,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { vMin, vMax } = useMemo(() => {
    const lo = powerMinDb ?? result?.minPowerDb ?? 0;
    const hi = powerMaxDb ?? result?.maxPowerDb ?? 1;
    return { vMin: lo, vMax: hi === lo ? lo + 1 : hi };
  }, [powerMinDb, powerMaxDb, result?.minPowerDb, result?.maxPowerDb]);

  // Render the block to an offscreen bitmap at its native resolution once; the
  // draw step below only positions/scales it, so pan/zoom stays cheap.
  const offscreen = useMemo(() => {
    if (!result || result.numWindows === 0 || result.numFreqs === 0)
      return null;
    const { numWindows, numFreqs, powers } = result;
    const img = new ImageData(numWindows, numFreqs);
    const span = vMax - vMin;
    for (let w = 0; w < numWindows; w++) {
      for (let f = 0; f < numFreqs; f++) {
        const db = powers[w * numFreqs + f];
        const norm = (db - vMin) / span;
        const [r, g, b] = applyColormap(colormap, norm);
        // Flip the frequency axis so low frequencies are at the bottom.
        const row = numFreqs - 1 - f;
        const idx = (row * numWindows + w) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    const off = document.createElement("canvas");
    off.width = numWindows;
    off.height = numFreqs;
    off.getContext("2d")?.putImageData(img, 0, 0);
    return off;
  }, [result, colormap, vMin, vMax]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const plotW = width - margins.left - margins.right;
    const plotH = height - margins.top - margins.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const visSpan = visibleEndTimeSec - visibleStartTimeSec;
    const tToX = (t: number) =>
      margins.left + ((t - visibleStartTimeSec) / visSpan) * plotW;

    // Frequency range mapped from the (flipped) bitmap.
    const nyquist =
      (result?.freqStartHz ?? 0) +
      ((result?.numFreqs ?? 1) - 1) * (result?.freqStepHz ?? 0);
    const fMin = Math.max(0, freqMinHz);
    const fMax = result ? Math.min(nyquist, freqMaxHz) : freqMaxHz;

    if (offscreen && result && visSpan > 0) {
      const rowForFreq = (freq: number) =>
        result.numFreqs - 1 - freq / result.freqStepHz;
      const srcYTop = Math.max(0, rowForFreq(fMax));
      const srcYBottom = Math.min(result.numFreqs, rowForFreq(fMin));
      const srcH = Math.max(1, srcYBottom - srcYTop);

      // Absolute-time edges of the block.
      const halfStep = result.windowStepSec / 2;
      const blockStart = result.firstWindowCenterTimeSec - halfStep;
      const blockEnd =
        result.firstWindowCenterTimeSec +
        (result.numWindows - 1) * result.windowStepSec +
        halfStep;
      const destX0 = tToX(blockStart);
      const destX1 = tToX(blockEnd);

      ctx.save();
      ctx.beginPath();
      ctx.rect(margins.left, margins.top, plotW, plotH);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        offscreen,
        0,
        srcYTop,
        result.numWindows,
        srcH,
        destX0,
        margins.top,
        destX1 - destX0,
        plotH,
      );
      ctx.restore();
    } else {
      ctx.fillStyle = "#888";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        loading ? "Computing spectrogram…" : "No data",
        width / 2,
        height / 2,
      );
    }

    // Axes frame
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.strokeRect(margins.left, margins.top, plotW, plotH);

    // Time axis (x) — labels the visible window.
    ctx.fillStyle = "#222";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const numXTicks = 6;
    for (let i = 0; i <= numXTicks; i++) {
      const frac = i / numXTicks;
      const x = margins.left + frac * plotW;
      const t = visibleStartTimeSec + frac * visSpan;
      ctx.strokeStyle = "#999";
      ctx.beginPath();
      ctx.moveTo(x, margins.top + plotH);
      ctx.lineTo(x, margins.top + plotH + 4);
      ctx.stroke();
      ctx.fillText(t.toFixed(2), x, margins.top + plotH + 6);
    }
    ctx.fillText("Time (s)", margins.left + plotW / 2, height - 14);

    // Frequency axis (y)
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const numYTicks = 6;
    for (let i = 0; i <= numYTicks; i++) {
      const frac = i / numYTicks;
      const y = margins.top + plotH - frac * plotH;
      const f = fMin + frac * (fMax - fMin);
      ctx.strokeStyle = "#999";
      ctx.beginPath();
      ctx.moveTo(margins.left - 4, y);
      ctx.lineTo(margins.left, y);
      ctx.stroke();
      ctx.fillText(f.toFixed(0), margins.left - 6, y);
    }
    ctx.save();
    ctx.translate(14, margins.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Frequency (Hz)", 0, 0);
    ctx.restore();

    // Colorbar
    if (result) {
      const barX = width - margins.right + 24;
      const barW = 14;
      const barTop = margins.top;
      const barH = plotH;
      const grad = ctx.createLinearGradient(0, barTop + barH, 0, barTop);
      for (let s = 0; s <= 10; s++) {
        const [r, g, b] = applyColormap(colormap, s / 10);
        grad.addColorStop(s / 10, `rgb(${r},${g},${b})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(barX, barTop, barW, barH);
      ctx.strokeStyle = "#333";
      ctx.strokeRect(barX, barTop, barW, barH);
      ctx.fillStyle = "#222";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${vMax.toFixed(0)}`, barX + barW + 4, barTop + 4);
      ctx.fillText(`${vMin.toFixed(0)}`, barX + barW + 4, barTop + barH - 4);
      ctx.save();
      ctx.translate(barX + barW + 34, barTop + barH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText("Power (dB)", 0, 0);
      ctx.restore();
    }
  }, [
    offscreen,
    result,
    width,
    height,
    colormap,
    visibleStartTimeSec,
    visibleEndTimeSec,
    freqMinHz,
    freqMaxHz,
    vMin,
    vMax,
    loading,
  ]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export default SpectrogramWidget;
