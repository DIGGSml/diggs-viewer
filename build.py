#!/usr/bin/env python3
"""
Build script for DIGGS self-contained HTML viewer.

Bundles src/ files into a single HTML file, optionally embedding a DIGGS XML.

Usage:
    python build.py                          # Viewer with drag-and-drop
    python build.py --xml path/to/file.xml   # Viewer with embedded XML
    python build.py --xml file.xml -o out.html
"""

import argparse
from pathlib import Path


SRC = Path(__file__).parent / "src"

JS_FILES = [
    ("// PARSER_JS", SRC / "js" / "parser.js"),
    ("// TABLES_JS", SRC / "js" / "tables.js"),
    ("// CHARTS_JS", SRC / "js" / "charts.js"),
    ("// BORING_LOG_JS", SRC / "js" / "boring-log.js"),
    ("// CROSS_SECTION_JS", SRC / "js" / "cross-section.js"),
    ("// CALCULATIONS_JS", SRC / "js" / "calculations.js"),
    ("// UI_JS", SRC / "js" / "ui.js"),
]


def build(xml_path: Path | None = None, output_path: Path | None = None) -> Path:
    template = (SRC / "index.html").read_text(encoding="utf-8")

    # Inline CSS
    css = (SRC / "css" / "styles.css").read_text(encoding="utf-8")
    template = template.replace("    /* APP_CSS */", css)

    # Inline Plotly
    plotly_path = SRC / "vendor" / "plotly-basic.min.js"
    if plotly_path.exists():
        plotly_js = plotly_path.read_text(encoding="utf-8")
    else:
        # Use CDN fallback placeholder
        plotly_js = ""
        # Replace the script tag with a CDN link
        template = template.replace(
            '<script><!-- PLOTLY_JS --></script>',
            '<script src="https://cdn.plot.ly/plotly-basic-2.35.2.min.js"></script>',
        )

    if plotly_js:
        template = template.replace("<!-- PLOTLY_JS -->", plotly_js)

    # Inline app JS
    for placeholder, js_path in JS_FILES:
        js_content = js_path.read_text(encoding="utf-8")
        template = template.replace(placeholder, js_content)

    # Embed XML if provided
    if xml_path:
        xml_content = xml_path.read_text(encoding="utf-8")
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

    plotly_status = "bundled" if (SRC / "vendor" / "plotly-basic.min.js").exists() else "CDN"
    print(f"Plotly: {plotly_status}")

    return output_path


def main():
    parser = argparse.ArgumentParser(description="Build self-contained DIGGS HTML viewer")
    parser.add_argument("--xml", type=Path, help="DIGGS XML file to embed")
    parser.add_argument("-o", "--output", type=Path, help="Output HTML file path")
    args = parser.parse_args()

    if args.xml and not args.xml.exists():
        parser.error(f"XML file not found: {args.xml}")

    build(args.xml, args.output)


if __name__ == "__main__":
    main()
