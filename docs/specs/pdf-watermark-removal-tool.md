# PDF Watermark Removal Tool

## Problem Statement

Users print card sheets from PDFs that contain a watermark logo stamped on the first page. The watermark is positioned outside the card grid area and does not overlap card content. Currently, there is no way to remove these watermarks before printing, forcing users to either print with the watermark or use external PDF editing tools.

## Solution

A standalone page at `/tools/remove-watermark` that accepts a PDF upload, automatically detects and removes the watermark logo from the first page, and provides a clean PDF for download. The tool runs entirely in the browser using pdf-lib — no server-side processing. Two detection methods are offered: structural (PDF object parsing, default) and visual (image rendering + contour analysis). An advanced mode within visual detection allows manual watermark highlighting via click-drag rectangle or click-to-auto-boundary.

## User Stories

1. As a user, I want to upload a PDF file by clicking a dropzone or dragging a file onto it, so that I can quickly get started with watermark removal.
2. As a user, I want to see a progress bar during processing, so that I know the tool is working and hasn't frozen.
3. As a user, I want the watermark to be detected and removed automatically from the first page, so that I don't have to manually identify it.
4. As a user, I want the processed PDF to download immediately after processing completes, so that I can print it right away.
5. As a user, I want to see an error message if watermark removal fails, so that I know the download contains a clean PDF and not a partial result.
6. As a user, I want to choose between two detection methods (structural and visual), so that I can try a different approach if the default doesn't work.
7. As a user, I want structural detection to be the default method, so that I get the fastest result in the common case.
8. As a user, I want to use an advanced highlight mode within visual detection, so that I can manually mark the watermark when automatic detection fails.
9. As a user, I want to click and drag a rectangle over the watermark in highlight mode, so that I can precisely define the watermark region.
10. As a user, I want to click on the watermark and have a rectangle auto-detect around it, so that I don't have to manually trace the boundaries.
11. As a user, I want processing to happen in a web worker, so that the UI remains responsive during large file processing.
12. As a user, I want file processing to be chunked, so that memory usage stays manageable for large PDFs.
13. As a user, I want no file size limit, so that I can process any PDF the browser can handle.
14. As a user, I want the tool to only process the first page, so that processing is fast and targeted.
15. As a user, I want the output PDF to be identical to the source except for the removed watermark, so that no card content is lost or altered.
16. As a user, I want the upload dropzone to clearly indicate it accepts PDF files, so that I don't accidentally upload the wrong file type.
17. As a user, I want to see the detected watermark highlighted on the page before download (in advanced mode), so that I can verify the correct region was identified.
18. As a user, I want a cancel button during processing, so that I can abort if I uploaded the wrong file.
19. As a user, I want the tool to work entirely in the browser with no server upload, so that my PDF contents remain private.
20. As a user, I want the page to follow the Tabletop Companion design system, so that the tool feels integrated with the rest of the app.
21. As a user, I want the dropzone to accept PDF files via click-to-browse and drag-and-drop, so that I can use whichever interaction I prefer.
22. As a user, I want to see the filename and size of the uploaded PDF, so that I can confirm I uploaded the correct file.
23. As a user, I want the advanced mode toggle to be clearly labeled and separated from the default flow, so that I don't accidentally enable it.
24. As a user, I want the highlight canvas to overlay the rendered PDF page at the correct scale, so that my rectangle selection maps accurately to the PDF coordinates.
25. As a user, I want the auto-boundary detection to work by flood-filling from my click point and snapping to the contour, so that I get a precise rectangle with minimal effort.
26. As a user, I want to be able to redraw my highlight rectangle if I make a mistake, so that I can correct my selection before processing.
27. As a user, I want a "Process" button in advanced mode after highlighting, so that I can confirm my selection before removal begins.
28. As a user, I want the highlight rectangle to be visually distinct (e.g., dashed border, semi-transparent fill) so that I can see exactly what region I've selected.
29. As a user, I want the tool to detect the card grid as a large clustered group of rectangular images and treat anything outside it as the watermark candidate.
30. As a user, I want structural detection to parse PDF image XObjects and their bounding boxes to identify the watermark.
31. As a user, I want visual detection to render the page to a canvas, binarize it, find contours, mask the card grid, and detect remaining non-white content as the watermark.
32. As a user, I want the web worker to report progress updates (e.g., "Loading PDF...", "Detecting watermark...", "Removing watermark..."), so that I understand what stage the processing is at.
33. As a user, I want the dropzone to have a minimum height and be visually prominent, so that it's obvious where to upload.
34. As a user, I want the processed PDF filename to indicate it's been processed (e.g., `original-name_clean.pdf`), so that I can distinguish it from the source.

## Implementation Decisions

### Dependencies

- **pdf-lib**: Client-side PDF manipulation library. Used for parsing PDF structure, removing image XObjects, and serializing the output PDF.
- No other new runtime dependencies required. The tool is purely client-side.

### Modules to Build

- **Upload Dropzone Component**: Reusable file upload component accepting PDF files via click or drag-and-drop. Displays filename, size, and validation state.
- **Detection Method Selector**: UI control to switch between Structural (Method B) and Visual (Method A) detection. Defaults to Structural.
- **Advanced Mode Panel**: Conditionally rendered panel (only with Method A) containing the highlight canvas, auto-boundary controls, and process button.
- **Highlight Canvas**: Canvas overlay on the rendered PDF page supporting click-drag rectangle and click-to-auto-boundary (flood fill + contour detection).
- **Processing Engine (Web Worker)**: Offloads PDF processing to a web worker. Accepts the PDF ArrayBuffer and detection method, reports progress, returns the processed PDF or error.
- **Structural Detector**: Parses PDF image XObjects, identifies the card grid bounding box from clustered rectangular images, and removes the outlier image (watermark).
- **Visual Detector**: Renders the first page to canvas, binarizes the image, finds contours, identifies the card grid, masks it, and detects remaining non-white content as watermark coordinates.
- **Progress UI**: Displays processing stage and progress bar during worker execution.
- **Result Downloader**: Triggers browser download of the processed PDF with a derived filename.

### Architectural Decisions

- **Client-side only**: All processing happens in the browser. No server endpoints. PDFs never leave the user's machine.
- **Web Worker for processing**: The PDF processing pipeline runs in a dedicated web worker to keep the main thread responsive. The worker communicates via postMessage with progress callbacks.
- **Chunked processing**: Large PDFs are processed in chunks to manage memory. The worker processes page content in segments rather than loading the entire document into memory at once.
- **First page only**: Only the first page of the PDF is analyzed and processed. This simplifies the detection logic and improves performance.
- **Two detection methods**: Structural (PDF object parsing) is the default and fastest path. Visual (image rendering + contour analysis) is the fallback for edge cases. Advanced mode within visual detection provides manual override.
- **pdf-lib for both methods**: Both detection methods use pdf-lib for the final watermark removal step. The difference is only in how the watermark region is identified.

### Route Structure

- New route: `src/routes/tools/remove-watermark/+page.svelte`
- No server-side load functions required (purely client-side).

### Design System Integration

- Uses existing Tailwind v4 design tokens from `layout.css`.
- Cards use `surface-charcoal` background with `#FFFFFF10` border.
- Primary actions use `primary` (meeple green) with `on-primary` text.
- Secondary actions use outlined style with `secondary` borders.
- Error states use `error` and `error-container` tokens.
- Typography follows the Inter font scale defined in the design system.

## Testing Decisions

- **External behavior only**: Tests should verify the upload → process → download flow, not internal implementation details of detection algorithms.
- **Module testing**:
  - Upload Dropzone: file type validation, drag-and-drop, click-to-browse, filename/size display.
  - Detection methods: given a known test PDF, verify the correct watermark region is identified.
  - Web Worker: verify progress messages are posted and the processed PDF is returned correctly.
  - Highlight canvas: verify rectangle selection coordinates map correctly to PDF space.
- **Prior art**: No existing tests in the codebase. Vitest is available through Vite+ but not yet configured. Tests should be added as part of this work.
- **Test fixtures**: Sample PDFs with known watermarks should be created or sourced for testing both detection methods.

## Out of Scope

- Processing pages beyond the first page.
- Server-side processing or PDF storage.
- Watermark removal from text-based watermarks (only image/logo watermarks).
- Watermark detection for watermarks that overlap card content.
- Batch processing of multiple PDFs.
- Custom output filename editing.
- PDF preview before processing (outside of advanced mode highlight canvas).
- Support for non-PDF file formats.
- Watermark removal from scanned images (non-vector PDFs).

## Further Notes

- The `pdf-lib` library should be added as a dependency via `pnpm add pdf-lib`.
- The web worker file should be placed in `src/lib/workers/` and imported via Vite's `new Worker(new URL(...), { type: 'module' })` pattern.
- The highlight canvas in advanced mode needs to handle DPR (device pixel ratio) scaling for crisp rendering on high-DPI displays.
- The auto-boundary detection (click-to-auto-boundary) uses a flood-fill algorithm from the click point, expanding until it hits a boundary, then computing the bounding rectangle of the filled region.
- The structural detector should handle PDFs where the card grid images are grouped under a single Form XObject (common in card sheet generators) as well as PDFs where cards are individual image objects.
