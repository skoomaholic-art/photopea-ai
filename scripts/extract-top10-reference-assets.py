#!/usr/bin/env python3
"""Cut clean TOP10 PNG assets from the two supplied reference strips."""

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


def _large_components(mask: np.ndarray, minimum_size: int) -> np.ndarray:
    labels, count = ndimage.label(mask)
    sizes = np.bincount(labels.ravel())
    keep = np.zeros(count + 1, dtype=bool)
    if count:
        keep[1:] = sizes[1:] >= minimum_size
    return keep[labels]


def _enclosed_regions(
    edge: np.ndarray,
) -> tuple[np.ndarray, list[tuple[int, int]]]:
    regions, count = ndimage.label(~edge)
    border = set(
        np.unique(
            np.concatenate(
                (regions[0], regions[-1], regions[:, 0], regions[:, -1])
            )
        )
    )
    enclosed = [
        (label, int(np.count_nonzero(regions == label)))
        for label in range(1, count + 1)
        if label not in border
    ]
    enclosed.sort(key=lambda item: item[1], reverse=True)
    return regions, enclosed


def _fill_tiny_holes(edge: np.ndarray, maximum_size: int = 16) -> np.ndarray:
    regions, enclosed = _enclosed_regions(edge)
    tiny = [label for label, size in enclosed if size <= maximum_size]
    if not tiny:
        return edge
    return edge | np.isin(regions, tiny)


def extract_number(source: Image.Image, crop: list[int], glyph_count: int) -> Image.Image:
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
    edge = _large_components(core, minimum_size=80)
    edge = ndimage.binary_closing(edge, iterations=1)
    # Remove one-pixel poster fragments that survived the colour threshold.
    edge = ndimage.median_filter(edge.astype(np.uint8), size=3) > 0
    edge = _fill_tiny_holes(edge)

    # The coloured stroke separates the black glyph body from both the poster
    # and the counters. Keep the largest enclosed body per glyph and leave the
    # smaller counters transparent. Position 10 contains two separate glyphs.
    regions, enclosed = _enclosed_regions(edge)
    body_labels = [label for label, _ in enclosed[:glyph_count]]
    body = np.isin(regions, body_labels)

    # A cleaned edge can gain a pixel during median filtering. Copy the colour
    # from its nearest real stroke pixel instead of sampling poster background.
    _, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    edge_rgb = pixels[nearest[0], nearest[1], :3]

    result = np.zeros_like(pixels)
    result[body] = (0, 0, 0, 255)
    result[edge, :3] = edge_rgb[edge]
    result[edge, 3] = 255
    return Image.fromarray(result, "RGBA")


def resize_rgba_premultiplied(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize RGBA without dark fringes or Lanczos ringing in transparent pixels."""

    source = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    alpha = source[:, :, 3]
    premultiplied = source[:, :, :3] * alpha[:, :, None]

    def resize_channel(channel: np.ndarray) -> np.ndarray:
        plane = Image.fromarray(channel.astype(np.float32), "F")
        return np.asarray(
            plane.resize(size, Image.Resampling.BICUBIC), dtype=np.float32
        )

    resized_alpha = np.clip(resize_channel(alpha), 0.0, 1.0)
    resized_premultiplied = np.stack(
        [resize_channel(premultiplied[:, :, channel]) for channel in range(3)],
        axis=2,
    )

    # Bicubic can leave alpha values of one or two after the visible edge.
    # Removing them prevents isolated coloured dots on light poster artwork.
    resized_alpha[resized_alpha <= (2.0 / 255.0)] = 0.0
    resized_rgb = np.zeros_like(resized_premultiplied)
    visible = resized_alpha > 0
    resized_rgb[visible] = np.clip(
        resized_premultiplied[visible] / resized_alpha[visible, None], 0.0, 1.0
    )

    result = np.dstack((resized_rgb, resized_alpha))
    result = np.uint8(np.round(result * 255.0))
    result[result[:, :, 3] == 0, :3] = 0
    return Image.fromarray(result, "RGBA")


def main() -> None:
    NUMBER_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    for item in MANIFEST:
        number = str(item["number"])
        source = Image.open(FIXTURES / item["reference"])
        glyph_count = 2 if int(item["number"]) == 10 else 1
        extracted = extract_number(source, item["crop"], glyph_count)
        extracted.save(PREVIEW_DIR / f"{number}.png", optimize=True)

        scale = float(item["scale"])
        resized = resize_rgba_premultiplied(
            extracted,
            (round(extracted.width * scale), round(extracted.height * scale)),
        )
        master = Image.new("RGBA", (500, 500), (0, 0, 0, 0))
        master.alpha_composite(
            resized,
            (round(float(item["offsetX"])), round(float(item["offsetY"]))),
        )
        master.save(NUMBER_DIR / f"{number}.png", optimize=True)

    print("Built clean transparent TOP10 PNG cutouts: 1-10")


if __name__ == "__main__":
    main()
