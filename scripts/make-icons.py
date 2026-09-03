#!/usr/bin/env python3
"""
Builds the app icons in build/ from the master artwork in icon/.

electron-builder reads build/icon.ico for Windows and build/icon.png for macOS
and Linux by convention, and main.cjs loads the same PNG for the runtime window
and taskbar icon so a dev run looks like an installed one.

Python rather than a Node script because the project has no image library in
its dependencies, and adding one just to resize a PNG at build time is a poor
trade. Run it by hand when the artwork changes:

    python scripts/make-icons.py

Requires Pillow (`pip install pillow`).
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - a helpful failure, not a stack trace
    sys.exit('Pillow is required: pip install pillow')

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'icon' / 'Prism.png'
BUILD = ROOT / 'build'

# Windows renders the .ico at every one of these; supplying each explicitly
# beats letting the shell downscale 256px artwork to 16px, which is where a
# detailed logo turns to mud.
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

# Fraction of the canvas left clear on the tightest side. The master art carries
# uneven transparent margins, so it is trimmed to its content first and
# re-padded evenly -- otherwise the logo sits visibly off-centre in the tile.
PADDING = 0.03


def squared(source: Path) -> Image.Image:
    """The artwork trimmed to its content and centred on a transparent square."""
    art = Image.open(source).convert('RGBA')
    box = art.getbbox()
    if box:
        art = art.crop(box)
    side = max(art.size)
    canvas_side = round(side / (1 - 2 * PADDING))
    canvas = Image.new('RGBA', (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(art, ((canvas_side - art.width) // 2, (canvas_side - art.height) // 2), art)
    return canvas


def main() -> None:
    if not SOURCE.exists():
        sys.exit(f'No artwork at {SOURCE.relative_to(ROOT)}')
    BUILD.mkdir(exist_ok=True)
    master = squared(SOURCE)

    png = BUILD / 'icon.png'
    master.resize((512, 512), Image.LANCZOS).save(png, format='PNG', optimize=True)

    ico = BUILD / 'icon.ico'
    # Pillow's ICO writer resamples from the image it is handed, so hand it the
    # largest size and let `sizes` enumerate the rest.
    master.resize((256, 256), Image.LANCZOS).save(ico, format='ICO', sizes=[(n, n) for n in ICO_SIZES])

    for path in (png, ico):
        print(f'{path.relative_to(ROOT)}  {path.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
