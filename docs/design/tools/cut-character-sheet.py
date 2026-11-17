"""Cut the Tariro character sheet into costumes. Run: python3 -I cut.py sheet.webp outdir"""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage
sheet = Image.open(sys.argv[1]).convert('RGBA')
out = sys.argv[2]
a = np.asarray(sheet)
alpha = a[:, :, 3].astype(int)
nb = alpha > 20
# Erase the red name labels first: short, wide shapes that are mostly label red. (Some touch
# a figure's hair, so they are found on a grown mask and cut out as rectangles.)
rgb = a[:, :, :3].astype(int)
labelred = (rgb[:, :, 0] > 170) & (rgb[:, :, 1] < 70) & (rgb[:, :, 2] < 80)
# Labels are pills of red with white text: find rows/cols where label red forms a pill.
pill, pn = ndimage.label(ndimage.binary_closing(labelred, iterations=4))
for i, sl in enumerate(ndimage.find_objects(pill)):
    h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
    fill = (pill[sl] == i + 1).mean()
    if 28 <= h <= 46 and w >= 45 and fill > 0.75:
        nb[max(sl[0].start - 2, 0):sl[0].stop + 2, max(sl[1].start - 2, 0):sl[1].stop + 2] = False
        alpha[max(sl[0].start - 2, 0):sl[0].stop + 2, max(sl[1].start - 2, 0):sl[1].stop + 2] = 0
# Shapes as drawn (no growing), so figures that only nearly touch stay apart.
raw, n = ndimage.label(nb)
objs = ndimage.find_objects(raw)
areas = ndimage.sum(nb, raw, index=range(1, n + 1))
big = [i + 1 for i in range(n) if areas[i] > 2000]
# Loose bits (hair strands, sparkles) join the nearest large shape.
lab = np.zeros_like(raw)
centres = {k: ((objs[k - 1][0].start + objs[k - 1][0].stop) / 2, (objs[k - 1][1].start + objs[k - 1][1].stop) / 2) for k in big}
def box_dist(sl, k):
    o = objs[k - 1]
    dy = max(o[0].start - sl[0].stop, sl[0].start - o[0].stop, 0)
    dx = max(o[1].start - sl[1].stop, sl[1].start - o[1].stop, 0)
    return dx + dy
for i in range(1, n + 1):
    sl = objs[i - 1]
    owner = i if i in big else min(big, key=lambda k: box_dist(sl, k))
    if i not in big and box_dist(sl, owner) > 12: continue  # specks far from any figure
    lab[sl][raw[sl] == i] = owner
pieces = []
for k in big:
    sl = objs[k - 1]
    if sl[0].stop - sl[0].start < 60: continue  # the red labels (~33 px tall)
    ys = np.where((lab == k).any(axis=1))[0]; xs = np.where((lab == k).any(axis=0))[0]
    pieces.append(((slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1)), k))

def split(sl, idx, count):
    """Split touching figures (the faces) at the emptiest columns."""
    m = (lab[sl] == idx) & nb[sl]
    cols = m.sum(axis=0).astype(float)
    w = m.shape[1]
    cuts = [0]
    for k in range(1, count):
        centre = int(w * k / count); lo, hi = centre - w // (3 * count), centre + w // (3 * count)
        cuts.append(lo + int(np.argmin(cols[lo:hi])))
    cuts.append(w)
    return [(slice(sl[0].start, sl[0].stop), slice(sl[1].start + cuts[j], sl[1].start + cuts[j + 1]), idx) for j in range(count)]

figs = []
for sl, idx in pieces:
    w = sl[1].stop - sl[1].start; h = sl[0].stop - sl[0].start
    count = max(1, round(w / 98)) if h < 150 and w > 140 else 1
    figs.extend(split(sl, idx, count) if count > 1 else [(sl[0], sl[1], idx)])

rows = {0: [], 1: [], 2: []}
for f in figs:
    y = f[0].start
    rows[0 if y < 300 else 1 if y < 650 else 2].append(f)
for r in rows.values(): r.sort(key=lambda f: (f[1].start if f[0].start < 800 or f[0].stop - f[0].start > 150 else f[1].start + 10000))
# Faces: top row of faces first, then the bottom row.
faces = sorted([f for f in rows[2] if f[0].stop - f[0].start < 150], key=lambda f: (f[0].start > 800, f[1].start))
body3 = [f for f in rows[2] if f[0].stop - f[0].start >= 150]

names = (
    [('walk', 5), ('run', 4), ('jump', 4), ('idle', 2)],
    [('talk', 4), ('think', 1), ('point', 1), ('teach', 2), ('laptop', 1), ('celebrate', 2), ('sad', 1)],
    [('crouch', 1), ('fall', 2), ('getup', 2), ('wave', 2)],
)
seq = [rows[0], rows[1], body3]
named = []
for r, plan in zip(seq, names):
    expect = sum(c for _, c in plan)
    print('row', len(r), 'expected', expect)
    k = 0
    for g, c in plan:
        for j in range(c):
            named.append((f'{g}-{j + 1}', g, r[k])); k += 1
for j, f in enumerate(faces):
    named.append((f'face-{j + 1}', 'face', f))
print('faces', len(faces))

def crop(f):
    ys, xs, idx = f
    m = ((lab[ys, xs] == idx) & (alpha[ys, xs] > 0))
    # Keep the main figure of the crop (a split can leave a sliver of the neighbour at an edge).
    parts, pc = ndimage.label(m)
    if pc > 1:
        sizes = ndimage.sum(m, parts, index=range(1, pc + 1))
        m &= parts == (1 + int(np.argmax(sizes)))
    sub = a[ys, xs].copy()
    sub[:, :, 3] = np.where(m, sub[:, :, 3], 0)
    img = Image.fromarray(sub)
    return img.crop(img.getbbox())

body = [(n, g, crop(f)) for n, g, f in named if g != 'face']
face = [(n, g, crop(f)) for n, g, f in named if g == 'face']
meta = []
for group, pad in ((body, 6), (face, 4)):
    W = max(i.width for _, _, i in group) + pad * 2
    H = max(i.height for _, _, i in group) + pad * 2
    for name, g, img in group:
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        # Feet on the same line in every pose (faces: centred), so switching costumes does not jump.
        y = H - pad - img.height if g != 'face' else (H - img.height) // 2
        canvas.paste(img, ((W - img.width) // 2, y))
        canvas.save(f'{out}/tariro-{name}.webp', 'WEBP', quality=90, method=6)
        meta.append({'id': f'tariro-{name}', 'group': g, 'w': W, 'h': H})
json.dump(meta, open(f'{out}/meta.json', 'w'), indent=1)
print(len(meta), 'costumes')
