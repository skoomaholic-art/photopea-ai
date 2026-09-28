#!/usr/bin/env python3
"""Build exact TOP10 PNG assets from the two supplied reference strips."""

from pathlib import Path
import json

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "top10"
NUMBER_DIR = ROOT / "assets" / "top10" / "numbers"
PREVIEW_DIR = ROOT / "assets" / "top10" / "reference-numbers"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))


def extract_number(source: Image.Image, crop: list[int]) -> Image.Image:
    left, top, right, bottom = crop
    pixels = np.asarray(source.convert("RGBA"))[top:bottom, left:right].copy()
    rgb = pixels[:, :, :3].astype(np.int16)
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)

    # The supplied artwork uses a green-to-blue edge around a black glyph.
    # Keep the exact source pixels for that edge and discard the poster behind it.
    core = (
        (rgb[:, :, 0] < 80)
        & (np.maximum(rgb[:, :, 1], rgb[:, :, 2]) > 65)
        & ((maximum - minimum) > 35)
    )
    labels, count = ndimage.label(core)
    sizes = np.bincount(labels.ravel())
    keep = np.zeros(count + 1, dtype=bool)
    if count:
        keep[1:] = sizes[1:] >= 80
    edge = keep[labels]
    edge = ndimage.binary_closing(edge, iterations=1)

    # Filling the outer contour recreates the opaque black body of the supplied
    # number. Counters stay black, matching the source artwork over its dark base.
    silhouette = ndimage.binary_fill_holes(edge)
    nearby = ndimage.binary_dilation(edge, iterations=2)
    antialias = (
        nearby
        & (np.maximum(rgb[:, :, 1], rgb[:, :, 2]) - rgb[:, :, 0] > 9)
        & (np.maximum(rgb[:, :, 1], rgb[:, :, 2]) > 20)
    )

    result = np.zeros_like(pixels)
    result[silhouette] = (0, 0, 0, 255)
    result[antialias, :3] = pixels[antialias, :3]
    result[antialias, 3] = 255
    return Image.fromarray(result, "RGBA")


def main() -> None:
    NUMBER_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    for item in MANIFEST:
        number = str(item["number"])
        source = Image.open(FIXTURES / item["reference"])
        extracted = extract_number(source, item["crop"])
        extracted.save(PREVIEW_DIR / f"{number}.png", optimize=True)

        scale = float(item["scale"])
        resized = extracted.resize(
            (round(extracted.width * scale), round(extracted.height * scale)),
            Image.Resampling.LANCZOS,
        )
        master = Image.new("RGBA", (500, 500), (0, 0, 0, 0))
        master.alpha_composite(
            resized,
            (round(float(item["offsetX"])), round(float(item["offsetY"]))),
        )
        master.save(NUMBER_DIR / f"{number}.png", optimize=True)

    print("Built exact TOP10 reference PNG assets: 1-10")


if __name__ == "__main__":
    main()
