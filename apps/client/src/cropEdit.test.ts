import { describe, expect, it } from "vitest";
import { ClipCropSchema, cropWindow } from "@ve/schema";
import { canLockCrop, editCrop, NO_CROP, type CropSide } from "./cropEdit.js";

describe("crop editing geometry", () => {
  const media = { width: 1920, height: 1080 }, frame = { width: 1080, height: 1920 };
  it("limits free edges independently and retains more than five percent", () => {
    const crop = editCrop(NO_CROP, "left", 0.3, "free", media, frame);
    expect(crop).toEqual({ ...NO_CROP, left: 0.3 });
    expect(editCrop(crop, "right", 1, "free", media, frame).right).toBeCloseTo(0.649);
    expect(editCrop(crop, "top", -0.5, "free", media, frame).top).toBe(0);
  });
  it("removes pointer arithmetic noise before whole-source-pixel rounding", () => {
    const crop = editCrop(NO_CROP, "left", (416 / 640 - 400 / 640) / 0.25, "free", media, frame);
    expect(crop.left).toBe(0.1);
    expect(cropWindow(crop, { width: 640, height: 360 }).width).toBe(0.9);
  });
  it("locks pixel dimensions to the project ratio, not equal fractional insets", () => {
    const crop = editCrop(NO_CROP, "top", 0.1, "locked", media, frame);
    const w = (1 - crop.left - crop.right) * media.width;
    const h = (1 - crop.top - crop.bottom) * media.height;
    expect(w / h).toBeCloseTo(frame.width / frame.height, 10);
    expect(crop.left).toBeCloseTo(crop.right, 10);
    expect(crop.top).toBeCloseTo(0.1);
  });
  it("preserves valid bounds and ratios across edges, canvas shapes and extreme drags", () => {
    for (const canvas of [frame, media, { width: 1, height: 1 }, { width: 4, height: 3 }]) {
      for (const side of ["left", "right", "top", "bottom"] as CropSide[]) {
        let crop = { left: 0.8, right: 0.1, top: 0.1, bottom: 0.2 };
        for (const value of [-1, 0, 0.1, 0.45, 0.9, 2]) {
          crop = editCrop(crop, side, value, "locked", media, canvas);
          expect(ClipCropSchema.safeParse(crop).success).toBe(true);
          expect((1 - crop.left - crop.right) * media.width / ((1 - crop.top - crop.bottom) * media.height))
            .toBeCloseTo(canvas.width / canvas.height, 9);
        }
      }
    }
  });
  it("explicitly rejects impossible source/project ratio combinations", () => {
    const extreme = { width: 100000, height: 1 };
    expect(canLockCrop(extreme, frame)).toBe(false);
    expect(() => editCrop(NO_CROP, "left", 0.1, "locked", extreme, frame)).toThrow(/crop limits/);
  });
});
