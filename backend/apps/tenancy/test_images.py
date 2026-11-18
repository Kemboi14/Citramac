import io

from django.test import SimpleTestCase
from PIL import Image

from .images import trim_margins


def _png(image):
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


class TrimMarginsTests(SimpleTestCase):
    def test_a_transparent_border_is_trimmed_to_the_artwork_with_a_small_margin(self):
        image = Image.new("RGBA", (1000, 1000), (0, 0, 0, 0))
        image.paste((46, 112, 95, 255), (300, 400, 700, 600))
        data, extension = trim_margins(_png(image), "logo.png")
        self.assertEqual(extension, "png")
        width, height = Image.open(io.BytesIO(data)).size
        self.assertTrue(400 <= width <= 440 and 200 <= height <= 240, (width, height))

    def test_a_plain_white_background_is_trimmed_too(self):
        image = Image.new("RGB", (400, 200), "white")
        image.paste((0, 100, 0), (150, 60, 250, 140))
        data, _ = trim_margins(_png(image), "logo.png")
        width, height = Image.open(io.BytesIO(data)).size
        self.assertLess(width, 130)
        self.assertLess(height, 100)

    def test_nothing_to_trim_svg_and_unreadable_files_are_returned_unchanged(self):
        full = _png(Image.new("RGB", (50, 50), (10, 20, 30)))
        self.assertEqual(trim_margins(full, "full.png"), (full, None))
        self.assertEqual(trim_margins(b"<svg/>", "logo.svg"), (b"<svg/>", None))
        self.assertEqual(trim_margins(b"not an image", "logo.png"), (b"not an image", None))
