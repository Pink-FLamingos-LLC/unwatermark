# PDF Watermark Removal Tool

A standalone tool for removing watermark logos from printed card sheet PDFs. Users upload a PDF, the tool detects and removes the watermark from the first page, and returns a clean PDF for download.

## Language

**Watermark**:
A logo image stamped onto the first page of a card sheet PDF, typically positioned outside the card grid area. Not overlapping card content.
_Avoid_: Stamp, overlay, branding, mark

**Card Block**:
The region containing the printable cards, detected as a single contiguous blob or a cluster of similarly-sized nearby blobs. Serves as the structural landmark for watermark detection.
_Avoid_: Card grid, card area, card layout

**Detection Method**:
The algorithm used to identify which image object on the page is the watermark. Two strategies are supported: structural (PDF object parsing) and visual (image rendering + contour analysis).
_Avoid_: Strategy, approach, mode

**Structural Detection (Method B)**:
Parses the PDF's image XObjects and their bounding boxes. Identifies the card grid as a large clustered group of rectangular images, then isolates any remaining image as the watermark. Default method. Only works when the watermark is a separate XObject — does not work when the watermark is embedded (baked) into the card image pixels.
_Avoid_: PDF parsing, object-level detection

**Visual Detection (Method A)**:
Renders the PDF page to a canvas, finds all non-background blobs, clusters similarly-sized nearby blobs into the Card Block, then detects the Watermark as the largest remaining blob outside the Card Block exceeding 1% of page area. Supports manual highlight override.
_Avoid_: Image-based detection, render-based detection

**Advanced Mode**:
A visual detection sub-mode where the user manually identifies the watermark region via click-drag rectangle or click-to-auto-boundary (flood fill + contour snap). Only available with Method A.
_Avoid_: Manual mode, highlight mode, user-guided mode

**Processed PDF**:
The output PDF after watermark removal. Must be identical to the source PDF except for the removed watermark layer.
_Avoid_: Clean PDF, output, result

**Source PDF**:
The original uploaded PDF file before any processing.
_Avoid_: Input, upload, original
