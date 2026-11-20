"""Build antialiased M5GFX VLW fonts from NULL FONT. Requires Pillow."""

from pathlib import Path
from struct import pack

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "fonts" / "null-font" / "NULLFont-Italic.ttf"
HEADER = ROOT / "firmware" / "NC04_Tab5" / "NullFont.h"
CHARACTERS = " -0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def rasterize(size):
    font = ImageFont.truetype(str(FONT), size)
    ascent, descent = font.getmetrics()
    metadata = bytearray(pack(">6i", len(CHARACTERS), 11, size, 0, ascent, descent))
    pixels = bytearray()
    for char in CHARACTERS:
        left, top, right, bottom = font.getbbox(char, anchor="ls")
        width, height = right - left, bottom - top
        metadata.extend(pack(">7i", ord(char), height, width, round(font.getlength(char)),
                             -top, left, 0))
        if width and height:
            image = Image.new("L", (width, height))
            ImageDraw.Draw(image).text((-left, -top), char, font=font, fill=255, anchor="ls")
            pixels.extend(image.tobytes())
    return metadata + pixels


def render():
    lines = [
        "#pragma once",
        "",
        "// Generated from NULLFont-Italic.ttf (SIL OFL 1.1) by firmware/build_null_font.py.",
        "#include <Arduino.h>",
    ]
    for name, size in (("nullFontBody", 28), ("nullFontHeading", 48)):
        data = rasterize(size)
        lines.extend(("", f"inline const uint8_t {name}[] PROGMEM = {{"))
        for index in range(0, len(data), 16):
            lines.append("    " + ", ".join(f"0x{value:02x}" for value in data[index:index + 16]) + ",")
        lines.append("};")
    HEADER.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    render()
