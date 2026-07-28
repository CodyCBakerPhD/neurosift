import { FunctionComponent, useEffect, useMemo, useRef } from "react";
import { applyColormap, ColormapName } from "./colormap";
import { SpectrogramResult } from "./WorkerTypes";

type Props = {
  result: SpectrogramResult;
  width: number;
  height: number;
  colormap: ColormapName;
  // Displayed frequency range (Hz).
  freqMinHz: number;
  freqMaxHz: number;
  // Power range (dB) mapped to the colormap; if undefined the data range is used.
  powerMinDb?: number;
  powerMaxDb?: number;
};

const margins = { top: 20, right: 90, bottom: 44, left: 64 };

const SpectrogramWidget: FunctionComponent<Props> = ({
  result,
  width,
  height,
  colormap,
  freqMinHz,
  freqMaxHz,
  powerMinDb,
  powerMaxDb,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { vMin, vMax } = useMemo(() => {
    const lo = powerMinDb ?? result.minPowerDb;
    const hi = powerMaxDb ?? result.maxPowerDb;
    return { vMin: lo, vMax: hi === lo ? lo + 1 : hi };
  }, [powerMinDb, powerMaxDb, result.minPowerDb, result.maxPowerDb]);

  // Render an offscreen bitmap at the native spectrogram resolution.
  const bitmap = useMemo(() => {
    const { numWindows, numFreqs, powers } = result;
    if (numWindows === 0 || numFreqs === 0) return null;
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
    return img;
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

    if (!bitmap || result.numWindows === 0) {
      ctx.fillStyle = "#666";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "Not enough samples for the selected window size",
        width / 2,
        height / 2,
      );
      return;
    }

    const nyquist =
      result.freqStartHz + (result.numFreqs - 1) * result.freqStepHz;
    const fMin = Math.max(0, freqMinHz);
    const fMax = Math.min(nyquist, freqMaxHz);

    // Source rows in the (flipped) bitmap corresponding to the freq window.
    const rowForFreq = (freq: number) =>
      result.numFreqs - 1 - freq / result.freqStepHz;
    const srcYTop = rowForFreq(fMax);
    const srcYBottom = rowForFreq(fMin);
    const srcH = Math.max(1, srcYBottom - srcYTop);

    // Draw the bitmap region into the plot area, letting the canvas scale it.
    const off = document.createElement("canvas");
    off.width = result.numWindows;
    off.height = result.numFreqs;
    const offCtx = off.getContext("2d");
    if (!offCtx) return;
    offCtx.putImageData(bitmap, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      off,
      0,
      srcYTop,
      result.numWindows,
      srcH,
      margins.left,
      margins.top,
      plotW,
      plotH,
    );

    // Axes frame
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.strokeRect(margins.left, margins.top, plotW, plotH);

    // Time axis (x)
    const tStart = result.firstWindowCenterTimeSec;
    const tEnd =
      result.firstWindowCenterTimeSec +
      (result.numWindows - 1) * result.windowStepSec;
    ctx.fillStyle = "#222";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const numXTicks = 6;
    for (let i = 0; i <= numXTicks; i++) {
      const frac = i / numXTicks;
      const x = margins.left + frac * plotW;
      const t = tStart + frac * (tEnd - tStart);
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
  }, [
    bitmap,
    result,
    width,
    height,
    colormap,
    freqMinHz,
    freqMaxHz,
    vMin,
    vMax,
  ]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export default SpectrogramWidget;
