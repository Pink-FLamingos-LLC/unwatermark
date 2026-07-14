# Dual Detection Strategy for Watermark Removal

We support two detection methods — structural (PDF object parsing) and visual (image rendering + contour analysis) — defaulting to structural. This decision was made because:

1. **Structural detection** is faster (no rendering step), lighter on memory, and works well for most card sheet PDFs where the card grid is clearly the dominant grouped content.

2. **Visual detection** handles edge cases where PDF structure is ambiguous (flattened layers, merged objects, unusual rendering pipelines). The image-based approach is more reliable when PDF internals are unpredictable.

3. **Advanced mode** (manual highlight) provides a safety valve for cases where both automated methods fail, without polluting the default experience.

The trade-off is increased implementation complexity. We accept this because the two methods serve genuinely different failure modes — structural fails on weird PDF internals, visual fails on performance with huge files. Having both covers more ground.
