"""
Renders MoveIQ brand assets from vector geometry (traced from the approved logo).
Run: python3 scripts/generate-brand-assets.py   (requires Pillow)
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops

BG = (7, 24, 34)            # dark navy
G_TOP = (58, 232, 160)      # bright green
G_BOT = (30, 205, 138)
T_LEFT = (34, 220, 150)     # small "A": green → teal
T_RIGHT = (40, 160, 150)

# Mark geometry in reference units (traced at 552px); bbox x 108..446, y 132..392.
BIG = [(110, 390), (255, 133), (292, 133), (334, 208), (312, 214), (214, 390)]
SMALL = [(232, 392), (322, 241), (352, 241), (446, 392), (362, 392), (347, 377), (331, 377), (317, 392)]
BX0, BY0, BX1, BY1 = 108, 132, 446, 392

def mask(poly, size, scale, ox, oy, round_px):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon([(ox + x * scale, oy + y * scale) for x, y in poly], fill=255)
    if round_px > 1:  # blur + threshold softens the corners into rounded ones (fast at any size)
        m = m.filter(ImageFilter.GaussianBlur(round_px / 2)).point(lambda v: 255 if v > 127 else 0)
    return m

def gradient(size, c0, c1, vertical=True):
    strip = Image.new('RGB', (1, 256) if vertical else (256, 1))
    for i in range(256):
        t = i / 255
        c = tuple(int(c0[j] + (c1[j] - c0[j]) * t) for j in range(3))
        strip.putpixel((0, i) if vertical else (i, 0), c)
    return strip.resize(size, Image.BILINEAR)

def render_mark(canvas, mark_width_frac, color=None):
    """Transparent RGBA image with the mark centered, mark width = canvas * frac. Supersampled 4x."""
    ss = 3
    S = canvas * ss
    scale = (S * mark_width_frac) / (BX1 - BX0)
    ox = (S - (BX1 - BX0) * scale) / 2 - BX0 * scale
    oy = (S - (BY1 - BY0) * scale) / 2 - BY0 * scale
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    r = 7 * scale  # corner rounding
    for poly, (c0, c1, vert) in ((BIG, (G_TOP, G_BOT, True)), (SMALL, (T_LEFT, T_RIGHT, False))):
        m = mask(poly, (S, S), scale, ox, oy, r)
        fill = Image.new('RGB', (S, S), color) if color else gradient((S, S), c0, c1, vert)
        out.paste(fill, (0, 0), m)
    return out.resize((canvas, canvas), Image.LANCZOS)

def rounded_square(canvas, radius_frac, color):
    ss = 4; S = canvas * ss
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * radius_frac), fill=255)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0)); img.paste(Image.new('RGB', (S, S), color), (0, 0), m)
    return img.resize((canvas, canvas), Image.LANCZOS)

def on_bg(canvas, mark_frac, rounded=False):
    base = rounded_square(canvas, 0.22, BG) if rounded else Image.new('RGBA', (canvas, canvas), BG + (255,))
    base.alpha_composite(render_mark(canvas, mark_frac))
    return base

A = 'assets/'
on_bg(1024, 0.62).save(A + 'icon.png')                                  # iOS: full-bleed, OS applies mask
render_mark(1024, 0.5).save(A + 'android-icon-foreground.png')         # adaptive: inside 66% safe zone
Image.new('RGBA', (1024, 1024), BG + (255,)).save(A + 'android-icon-background.png')
render_mark(1024, 0.5, color=(255, 255, 255)).save(A + 'android-icon-monochrome.png')  # themed icons
render_mark(1024, 0.70).save(A + 'splash-icon.png')
on_bg(512, 0.62, rounded=True).save(A + 'logo.png')                     # in-app / share card / docs
on_bg(48, 0.66, rounded=True).save(A + 'favicon.png')
print('Wrote icon.png, android-icon-{foreground,background,monochrome}.png, splash-icon.png, logo.png, favicon.png')
