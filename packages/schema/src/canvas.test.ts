import { describe, expect, it } from "vitest";
import { clipCanvasRect, cropWindow, fittedSize } from "./canvas.js";

describe("cropped canvas geometry", () => {
  const crop = { left: 0.25, top: 0.1, right: 0.25, bottom: 0.1 };

  it("rounds offsets and retained sizes down to whole source pixels", () => {
    const window = cropWindow(crop, { width: 101, height: 51 });
    expect(window).toEqual({ left: 25 / 101, top: 5 / 51, width: 50 / 101, height: 40 / 51 });
    expect(cropWindow(crop, { width: 1, height: 1 })).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    expect(cropWindow(crop, { width: null, height: null })).toEqual({ left: 0.25, top: 0.1, width: 0.5, height: 0.8 });
  });

  it("trims the original fitted source without changing its size or anchor", () => {
    const media = { width: 200, height: 100 }, frame = { width: 400, height: 200 };
    expect(fittedSize(frame, media)).toEqual({ width: 1, height: 1 });
    expect(fittedSize(frame, media, crop)).toEqual({ width: 0.5, height: 0.8 });
    expect(clipCanvasRect({ x: 0.75, y: 0.25, scale: 0.5, opacity: 1 }, frame, media, crop))
      .toEqual({ left: 0.625, top: expect.closeTo(0.05, 12), width: 0.25, height: 0.4 });
  });
  it("keeps the opposite edges fixed during asymmetric crops across canvas shapes and zoom", () => {
    const media = { width: 200, height: 100 }, transform = { x: 0.6, y: 0.4, scale: 1.7, opacity: 1 };
    for (const frame of [{ width: 400, height: 200 }, { width: 200, height: 400 }]) {
      const original = clipCanvasRect(transform, frame, media);
      const cropped = clipCanvasRect(transform, frame, media, { left: 0.2, top: 0.1, right: 0, bottom: 0 });
      expect(cropped.left + cropped.width).toBeCloseTo(original.left + original.width, 12);
      expect(cropped.top + cropped.height).toBeCloseTo(original.top + original.height, 12);
      expect(cropped.left).toBeCloseTo(original.left + original.width * 0.2, 12);
      expect(cropped.top).toBeCloseTo(original.top + original.height * 0.1, 12);
    }
  });

  it("keeps the original geometry for absent or zero crop", () => {
    const frame = { width: 360, height: 640 }, media = { width: 640, height: 360 };
    expect(clipCanvasRect(undefined, frame, media, { left: 0, top: 0, right: 0, bottom: 0 }))
      .toEqual(clipCanvasRect(undefined, frame, media));
  });
});
