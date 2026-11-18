"""
Logo and icon images: trim the empty margin around the artwork.

Uploaded logos often carry a wide transparent (or plain white) border, so
wherever they are fitted into a box — the sidebar tile, the sign-in card, a
document letterhead — the visible mark comes out small. Trimming keeps all the
artwork and removes only the uniform border, leaving a small breathing margin.
SVGs and anything Pillow cannot read are returned unchanged.
"""

import io

MARGIN_RATIO = 0.04  # breathing room kept around the artwork, per side
_TOLERANCE = 12  # how far from the border colour still counts as "empty"


def _content_box(image):
    from PIL import Image, ImageChops

    rgba = image.convert("RGBA")
    alpha_box = rgba.getchannel("A").point(lambda a: 255 if a > _TOLERANCE else 0).getbbox()
    if alpha_box is None:
        return None
    # Transparent border trimmed; now a solid border colour (e.g. white).
    cropped = rgba.crop(alpha_box)
    corner = cropped.getpixel((0, 0))
    if corner[3] < 255:
        return alpha_box
    background = Image.new("RGBA", cropped.size, corner)
    diff = ImageChops.difference(cropped, background).convert("L")
    solid_box = diff.point(lambda v: 255 if v > _TOLERANCE else 0).getbbox()
    if solid_box is None:
        return alpha_box
    return (
        alpha_box[0] + solid_box[0],
        alpha_box[1] + solid_box[1],
        alpha_box[0] + solid_box[2],
        alpha_box[1] + solid_box[3],
    )


def trim_margins(raw, filename=""):
    """Return (bytes, extension) with the empty border trimmed, or (raw, None)
    when the file is an SVG, unreadable, or has nothing to trim."""
    if filename.lower().endswith(".svg"):
        return raw, None
    try:
        from PIL import Image

        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            box = _content_box(image)
            if box is None:
                return raw, None
            width, height = image.size
            pad = round(max(box[2] - box[0], box[3] - box[1]) * MARGIN_RATIO)
            box = (
                max(0, box[0] - pad),
                max(0, box[1] - pad),
                min(width, box[2] + pad),
                min(height, box[3] + pad),
            )
            if box == (0, 0, width, height):
                return raw, None
            trimmed = image.convert("RGBA").crop(box)
            out = io.BytesIO()
            trimmed.save(out, format="PNG", optimize=True)
            return out.getvalue(), "png"
    except Exception:  # noqa: BLE001 — an odd image is stored as uploaded, never refused here
        return raw, None
