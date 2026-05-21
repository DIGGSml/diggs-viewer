#!/usr/bin/env python3
"""
Build script for DIGGS self-contained HTML viewer.

Bundles src/ files into a single HTML file, optionally embedding a DIGGS XML
and a custom logo.

Usage:
    python build.py                          # Viewer with drag-and-drop
    python build.py --xml path/to/file.xml   # Viewer with embedded XML
    python build.py --xml file.xml --logo logo.png -o out.html
    python build.py --xml file.xml --logo logo.png --link https://acme.com
    python build.py --no-logo                # Strip logo entirely
"""

import argparse
import base64
import html as html_lib
import io
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image

SRC = Path(__file__).parent / "src"

# Default branding: the official DIGGS logo, linking to the DIGGS project page
# at ASCE's Geo-Institute. Shown on every viewer built without a custom logo.
DEFAULT_LOGO = Path(__file__).parent / "diggs-default-logo.jpg"
DEFAULT_LOGO_LINK = "https://www.geoinstitute.org/special-projects/diggs"

PLOTLY_URL = "https://cdn.plot.ly/plotly-basic-2.35.2.min.js"

JS_FILES = [
    ("// PARSER_JS", SRC / "js" / "parser.js"),
    ("// TABLES_JS", SRC / "js" / "tables.js"),
    ("// CHARTS_JS", SRC / "js" / "charts.js"),
    ("// BORING_LOG_JS", SRC / "js" / "boring-log.js"),
    ("// CROSS_SECTION_JS", SRC / "js" / "cross-section.js"),
    ("// CALCULATIONS_JS", SRC / "js" / "calculations.js"),
    ("// UI_JS", SRC / "js" / "ui.js"),
]

# --- Logo validation constants ---
MAX_LOGO_BYTES = 256 * 1024          # 256 KB raw upload limit
MAX_LOGO_PIXELS = 512 * 512          # Prevent decompression bombs
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def validate_and_encode_logo(raw_bytes: bytes, filename: str) -> str:
    """Validate an image and return a safe base64 data URI.

    Security measures:
    1. Size cap (pre-decode) — prevents upload abuse
    2. Extension allowlist (no SVG) — prevents XSS via embedded scripts
    3. Pillow decode — validates it's a real image, not a polyglot
    4. Pixel cap — prevents decompression bombs
    5. Re-encode to PNG — strips EXIF/metadata, neutralizes payloads
    6. Returns clean data URI

    Raises ValueError on any validation failure.
    """
    # 1. Size check
    if len(raw_bytes) > MAX_LOGO_BYTES:
        raise ValueError(
            f"Logo too large: {len(raw_bytes)} bytes (max {MAX_LOGO_BYTES})"
        )

    # 2. Extension allowlist — SVG is explicitly excluded
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"Unsupported logo format: '{ext}'. "
            f"Allowed: {sorted(ALLOWED_EXTENSIONS)}"
        )

    # 3. Decode with Pillow (rejects non-image payloads)
    try:
        Image.MAX_IMAGE_PIXELS = MAX_LOGO_PIXELS
        img = Image.open(io.BytesIO(raw_bytes))
        img.verify()  # Integrity check without full decode
        # Re-open after verify (verify leaves file unusable)
        img = Image.open(io.BytesIO(raw_bytes))
    except Exception as e:
        raise ValueError(f"Invalid image file: {e}")

    # 4. Pixel dimensions check
    w, h = img.size
    if w * h > MAX_LOGO_PIXELS:
        raise ValueError(
            f"Logo too large: {w}x{h} ({w * h} pixels, max {MAX_LOGO_PIXELS})"
        )

    # 5. Re-encode to PNG (strips EXIF, neutralizes polyglot payloads)
    img = img.convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    clean_bytes = buf.getvalue()

    # 6. Base64 encode
    b64 = base64.b64encode(clean_bytes).decode("ascii")
    return f'<img class="app-logo" src="data:image/png;base64,{b64}" alt="">'


# --- Logo link sanitization ---
#
# Recipients of the wrapped viewer open it offline. Any link we embed runs in
# their browser, so the URL has to be locked down at *generation* time. The
# moment we add user-provided links to the viewer, we become responsible for
# whatever ends up there. These guards are non-negotiable.

MAX_LINK_LENGTH = 2048  # URL length cap (RFC-ish; browsers vary)


def sanitize_logo_link(link: str) -> str:
    """Validate a logo hyperlink for safe embedding.

    Enforces:
      - https:// scheme only (blocks javascript:, data:, vbscript:, file:, mailto:)
      - parseable URL with a hostname
      - length cap
    Returns the URL unchanged on success; raises ValueError on any failure.
    HTML-escaping happens at the embedding point, not here.
    """
    if not isinstance(link, str):
        raise ValueError("link must be a string")
    link = link.strip()
    if not link:
        raise ValueError("link is empty")
    if len(link) > MAX_LINK_LENGTH:
        raise ValueError(f"link too long: {len(link)} chars (max {MAX_LINK_LENGTH})")
    parsed = urlparse(link)
    if parsed.scheme != "https":
        raise ValueError(
            f"link scheme '{parsed.scheme}' not allowed — only https:// is permitted"
        )
    if not parsed.netloc:
        raise ValueError("link is missing a hostname")
    return link


def wrap_logo_with_link(img_html: str, link: str) -> str:
    """Wrap an <img> in a hyperlink, escaping the URL into the href attribute.

    The link MUST have already passed sanitize_logo_link() — callers should
    not skip that step.
    """
    safe_href = html_lib.escape(link, quote=True)
    return (
        f'<a class="app-logo-link" href="{safe_href}" '
        f'target="_blank" rel="noopener noreferrer">{img_html}</a>'
    )


def default_logo_html() -> str:
    """Return the bundled DIGGS logo wrapped in a link to the DIGGS project page.

    Empty string if the default logo file is missing — the viewer header falls
    back to the text "DIGGS Viewer" with no image.
    """
    if not DEFAULT_LOGO.exists():
        return ""
    raw = DEFAULT_LOGO.read_bytes()
    img_html = validate_and_encode_logo(raw, DEFAULT_LOGO.name)
    return wrap_logo_with_link(img_html, DEFAULT_LOGO_LINK)


def build(
    xml_path: Path | None = None,
    output_path: Path | None = None,
    logo_path: Path | None = None,
    no_logo: bool = False,
    link: str | None = None,
) -> Path:
    """Build a self-contained HTML viewer.

    Args:
        xml_path: DIGGS XML to embed. None for drag-and-drop viewer.
        output_path: Where to write the HTML. Auto-named if None.
        logo_path: Custom logo image. None falls back to the bundled DIGGS logo.
        no_logo: If True, build with no logo at all.
        link: Optional hyperlink to wrap around a custom logo. Ignored unless
              logo_path is set. Must be https://. If logo_path is None, the
              bundled DIGGS logo always links to the official DIGGS project page.
    """
    template = (SRC / "index.html").read_text(encoding="utf-8")

    # Inline CSS
    css = (SRC / "css" / "styles.css").read_text(encoding="utf-8")
    template = template.replace("    /* APP_CSS */", css)

    # Inline Plotly — download if not cached locally
    plotly_path = SRC / "vendor" / "plotly-basic.min.js"
    if not plotly_path.exists():
        print("Downloading Plotly.js...")
        plotly_path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(PLOTLY_URL, plotly_path)
        print(f"Saved to {plotly_path}")

    plotly_js = plotly_path.read_text(encoding="utf-8")
    template = template.replace("<!-- PLOTLY_JS -->", plotly_js)

    # Inline app JS
    for placeholder, js_path in JS_FILES:
        js_content = js_path.read_text(encoding="utf-8")
        template = template.replace(placeholder, js_content)

    # Logo handling
    logo_html = ""
    if no_logo:
        pass  # Leave empty
    elif logo_path:
        raw = logo_path.read_bytes()
        img_html = validate_and_encode_logo(raw, logo_path.name)
        if link:
            sanitized = sanitize_logo_link(link)
            logo_html = wrap_logo_with_link(img_html, sanitized)
        else:
            logo_html = img_html
    else:
        # Default: bundled DIGGS logo, linked to the DIGGS project page.
        logo_html = default_logo_html()

    template = template.replace("<!-- DIGGS_LOGO -->", logo_html)

    # Embed XML if provided
    if xml_path:
        xml_content = xml_path.read_text(encoding="utf-8")
        # SECURITY: Reject XML containing </script sequences.
        # The XML is embedded inside <script type="application/xml">. The HTML
        # parser terminates on ANY </script> (case-insensitive), allowing XSS
        # breakout. No legitimate DIGGS XML contains this sequence.
        import re
        if re.search(r'</\s*script', xml_content, re.IGNORECASE):
            raise ValueError(
                "XML contains '</script' which would break the HTML container. "
                "This is not valid DIGGS data."
            )
        template = template.replace("<!-- DIGGS_XML -->", xml_content)
    else:
        template = template.replace("<!-- DIGGS_XML -->", "")

    # Determine output filename
    if output_path is None:
        if xml_path:
            output_path = Path(f"viewer_{xml_path.stem}.html")
        else:
            output_path = Path("viewer.html")

    output_path.write_text(template, encoding="utf-8")

    # Report size
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Built: {output_path} ({size_mb:.1f} MB)")

    if xml_path:
        print(f"Embedded: {xml_path.name}")
    else:
        print("No XML embedded — viewer will show drag-and-drop file picker")

    if logo_html:
        src = logo_path or DEFAULT_LOGO
        print(f"Logo: {src.name}")
    elif no_logo:
        print("Logo: disabled")
    else:
        print("Logo: none (default not found)")

    print("Plotly: bundled")

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Build self-contained DIGGS HTML viewer"
    )
    parser.add_argument("--xml", type=Path, help="DIGGS XML file to embed")
    parser.add_argument("-o", "--output", type=Path, help="Output HTML file path")
    parser.add_argument("--logo", type=Path, help="Custom logo image (png/jpg/gif/webp)")
    parser.add_argument(
        "--no-logo", action="store_true", help="Build with no logo"
    )
    parser.add_argument(
        "--link",
        help="Optional https:// URL to wrap around a custom logo. "
             "Requires --logo. Ignored otherwise.",
    )
    args = parser.parse_args()

    if args.xml and not args.xml.exists():
        parser.error(f"XML file not found: {args.xml}")

    if args.logo and not args.logo.exists():
        parser.error(f"Logo file not found: {args.logo}")

    if args.logo and args.no_logo:
        parser.error("Cannot use both --logo and --no-logo")

    if args.link and not args.logo:
        parser.error("--link requires --logo (custom link only applies to a custom logo)")

    build(args.xml, args.output, args.logo, args.no_logo, args.link)


if __name__ == "__main__":
    main()
