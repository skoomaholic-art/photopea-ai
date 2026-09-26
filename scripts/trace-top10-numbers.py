"""Rebuild native SVG assets from the two user-supplied TOP10 references.

Run from the repo root with Python, Pillow, NumPy and SciPy installed.
The screenshots are test fixtures, never shipped to the application.
All digits use one pixel scale and baseline, including both digits of 10.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests/fixtures/top10"
SCALE = 2.44
# Screenshot coordinates. Separate shapes in 10 have separate gradients.
CROPS = [(158, 5, 234, 135), (492, 5, 608, 135), (850, 5, 971, 135),
         (1209, 5, 1335, 135), (1573, 5, 1692, 135),
         (144, 7, 262, 138), (509, 7, 625, 138), (861, 7, 978, 138),
         (1220, 7, 1337, 138), (1557, 7, 1731, 138)]


def unit(v):
    return v / max(np.linalg.norm(v), 1e-12)


def bezier_fit(points, left, right, tolerance=.65):
    """Least-squares cubic fitting with recursive error-bounded subdivision."""
    if len(points) == 2:
        d = np.linalg.norm(points[1]-points[0])/3
        return [[points[0], points[0]+left*d, points[1]+right*d, points[1]]]
    u = np.r_[0, np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
    u /= u[-1]
    basis = np.array([(1-u)**3, 3*u*(1-u)**2, 3*u*u*(1-u), u**3]).T
    a = np.stack([basis[:, 1, None]*left, basis[:, 2, None]*right], axis=2)
    residual = points - ((basis[:, 0]+basis[:, 1])[:, None]*points[0]
                         + (basis[:, 2]+basis[:, 3])[:, None]*points[-1])
    alpha = np.linalg.lstsq(a.reshape(-1, 2), residual.reshape(-1), rcond=None)[0]
    distance = np.linalg.norm(points[-1]-points[0])
    if min(alpha) < distance*1e-6:
        alpha[:] = distance/3
    control = np.array([points[0], points[0]+left*alpha[0],
                        points[-1]+right*alpha[1], points[-1]])
    error = np.sum((basis @ control-points)**2, axis=1)
    split = int(np.argmax(error))
    if error[split] <= tolerance**2:
        return [control]
    split = max(1, min(len(points)-2, split))
    tangent = unit(points[split-1]-points[split+1])
    return (bezier_fit(points[:split+1], left, tangent, tolerance)
            + bezier_fit(points[split:], -tangent, right, tolerance))


def contours(mask):
    field = ndimage.gaussian_filter(np.pad(mask.astype(float), 1), .85)
    segments = []
    for y in range(field.shape[0]-1):
        for x in range(field.shape[1]-1):
            xy = np.array([(x, y), (x+1, y), (x+1, y+1), (x, y+1)], float)
            values = np.array([field[y, x], field[y, x+1], field[y+1, x+1], field[y+1, x]])
            edges = []
            for start, end in [(0, 1), (1, 2), (2, 3), (3, 0)]:
                if (values[start] > .5) != (values[end] > .5):
                    t = (.5-values[start])/(values[end]-values[start])
                    # Pixel centers in the original unpadded screenshot.
                    edges.append(tuple(np.round(xy[start]+t*(xy[end]-xy[start])-.5, 6)))
            if len(edges) == 2:
                segments.append(edges)
            elif len(edges) == 4:
                segments.extend([edges[:2], edges[2:]])
    adjacent = {}
    for a, b in segments:
        adjacent.setdefault(a, []).append(b)
        adjacent.setdefault(b, []).append(a)
    result = []
    while adjacent:
        first = next(iter(adjacent))
        point = first
        loop = []
        while True:
            loop.append(point)
            nxt = adjacent[point].pop()
            if not adjacent[point]:
                del adjacent[point]
            adjacent[nxt].remove(point)
            if not adjacent[nxt]:
                del adjacent[nxt]
            point = nxt
            if point == first:
                break
        if len(loop) > 10:
            result.append(np.array(loop))
    return result


def path_for(loop):
    smooth = ndimage.gaussian_filter1d(loop, 1.3, axis=0, mode="wrap")
    tangent = unit(smooth[1]-smooth[-1])
    curves = bezier_fit(np.vstack([smooth, smooth[0]]), tangent, -tangent)
    pair = lambda p: f"{p[0]:.3f},{p[1]:.3f}"
    return "M"+pair(curves[0][0])+" "+" ".join(
        "C"+" ".join(pair(p) for p in c[1:]) for c in curves)+"Z"


def area(loop):
    return abs(np.sum(loop[:, 0]*np.roll(loop[:, 1], -1)-loop[:, 1]*np.roll(loop[:, 0], -1)))/2


manifest = []
for number, crop in enumerate(CROPS, 1):
    name = "1-5.png" if number <= 5 else "6-10.png"
    rgb = np.asarray(Image.open(FIXTURES/name).convert("RGB").crop(crop)).astype(float)
    mask = ((rgb[:, :, 0] < 65) & (np.maximum(rgb[:, :, 1], rgb[:, :, 2])-rgb[:, :, 0] > 45)
            & (np.maximum(rgb[:, :, 1], rgb[:, :, 2]) > 75))
    labels, _ = ndimage.label(mask)
    sizes = np.bincount(labels.ravel())
    mask &= sizes[labels] > 100
    ys, xs = np.nonzero(mask)
    offset_x = 250-(xs.min()+xs.max()+1)*SCALE/2
    offset_y = 130+(crop[1]-(9 if number <= 5 else 11))*SCALE
    groups = [mask]
    if number == 10:
        # Identify the outer ring of each digit and its enclosed counters.
        large = [i for i in range(1, len(sizes)) if sizes[i] > 2000]
        groups = []
        for label in large:
            silhouette = ndimage.binary_fill_holes(labels == label)
            groups.append(mask & silhouette)
    paths, defs = [], []
    for group_index, group in enumerate(groups):
        loops = sorted(contours(group), key=area, reverse=True)
        gy, gx = np.nonzero(group)
        x0, x1 = gx.min(), gx.max()+1
        # Estimate the screenshot's horizontal gradient from non-antialiased pixels.
        interior = ndimage.binary_erosion(group, iterations=2)
        py, px = np.nonzero(interior)
        design = np.column_stack([np.ones(len(px)), (px-x0)/(x1-x0)])
        coeff = np.linalg.lstsq(design, rgb[py, px], rcond=None)[0]
        colors = [np.clip(np.round(coeff[0]+t*coeff[1]), 0, 255).astype(int) for t in [0, 1]]
        hexes = ["#"+"".join(f"{v:02x}" for v in color) for color in colors]
        ident = f"g{group_index}"
        defs.append(f'<linearGradient id="{ident}" gradientUnits="userSpaceOnUse" x1="{x0}" x2="{x1}" y1="0" y2="0"><stop stop-color="{hexes[0]}"/><stop offset="1" stop-color="{hexes[1]}"/></linearGradient>')
        paths.append(f'<path d="{path_for(loops[0])}" fill="#000"/>')
        paths.append(f'<path d="{" ".join(path_for(loop) for loop in loops)}" fill="url(#{ident})" fill-rule="evenodd"/>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500" role="img" aria-label="{number}">\n'
           f'  <defs>{"".join(defs)}</defs>\n'
           f'  <g transform="translate({offset_x:.5f} {offset_y:.5f}) scale({SCALE})">\n    '
           + "\n    ".join(paths)+"\n  </g>\n</svg>\n")
    (ROOT/f"assets/top10/numbers/{number}.svg").write_text(svg)
    manifest.append(dict(number=number, reference=name, crop=crop, scale=SCALE,
                         offsetX=offset_x, offsetY=offset_y))
(FIXTURES/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
print("Rebuilt 10 SVG assets with a shared scale and screenshot contour references.")
