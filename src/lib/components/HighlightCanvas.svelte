<script lang="ts">
	import { floodFillBoundary, getLuminance } from '$lib/workers/flood-fill';
	import type { BoundingBox } from '$lib/workers/types';

	const WHITE_LUMINANCE_THRESHOLD = 225;
	const FLOOD_FILL_TOLERANCE = 30;
	const MIN_DRAG_PX = 3;

	interface Props {
		pdfFile: File;
		pageWidth: number;
		pageHeight: number;
		onselect?: (box: BoundingBox) => void;
		onclear?: () => void;
		onpagedimensions?: (width: number, height: number) => void;
	}

	let { pdfFile, pageWidth, pageHeight, onselect, onclear, onpagedimensions }: Props = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let pdfCanvasEl: HTMLCanvasElement | undefined = $state();
	let overlayCanvasEl: HTMLCanvasElement | undefined = $state();

	let isDragging = $state(false);
	let dragStart = $state<{ x: number; y: number } | null>(null);
	let dragEnd = $state<{ x: number; y: number } | null>(null);
	let selection = $state<BoundingBox | null>(null);
	let isLoading = $state(true);
	let renderGeneration = 0;

	let canvasCssWidth = $state(0);
	let canvasCssHeight = $state(0);

	$effect(() => {
		void pdfFile;
		const canvas = pdfCanvasEl;
		if (!canvas) return;
		const gen = ++renderGeneration;
		isLoading = true;
		selection = null;
		onclear?.();

		(async () => {
			const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
			const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
			pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

			const buf = await pdfFile.arrayBuffer();
			const doc = await pdfjsLib.getDocument({ data: buf }).promise;
			const page = await doc.getPage(1);
			const vp = page.getViewport({ scale: 1 });

			const dpr = window.devicePixelRatio || 1;
			const containerW = containerEl?.clientWidth ?? 800;
			const scale = containerW / vp.width;
			const scaledVp = page.getViewport({ scale });

			if (gen !== renderGeneration) return;

			onpagedimensions?.(vp.width, vp.height);

			canvasCssWidth = scaledVp.width;
			canvasCssHeight = scaledVp.height;

			canvas.width = Math.round(scaledVp.width * dpr);
			canvas.height = Math.round(scaledVp.height * dpr);
			canvas.style.width = `${scaledVp.width}px`;
			canvas.style.height = `${scaledVp.height}px`;

			const ctx = canvas.getContext('2d')!;
			ctx.scale(dpr, dpr);

			await page.render({ canvas: null, canvasContext: ctx, viewport: scaledVp }).promise;
			if (gen !== renderGeneration) return;

			if (overlayCanvasEl) {
				overlayCanvasEl.width = canvas.width;
				overlayCanvasEl.height = canvas.height;
				overlayCanvasEl.style.width = canvas.style.width;
				overlayCanvasEl.style.height = canvas.style.height;
			}

			isLoading = false;
		})();
	});

	function canvasToPdf(cssX: number, cssY: number): { pdfX: number; pdfY: number } {
		return {
			pdfX: (cssX / canvasCssWidth) * pageWidth,
			pdfY: (cssY / canvasCssHeight) * pageHeight,
		};
	}

	function toCanvas(e: MouseEvent): { x: number; y: number } | null {
		const canvas = overlayCanvasEl;
		if (!canvas) return null;
		const r = canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function handleMousedown(e: MouseEvent) {
		if (isLoading) return;
		const pos = toCanvas(e);
		if (!pos) return;

		const pdfCanvas = pdfCanvasEl;
		if (!pdfCanvas) return;
		const dpr = window.devicePixelRatio || 1;
		const ctx = pdfCanvas.getContext('2d')!;
		const px = Math.floor(pos.x * dpr);
		const py = Math.floor(pos.y * dpr);
		const pixel = ctx.getImageData(px, py, 1, 1).data;
		const lum = getLuminance(pixel, 0);

		if (lum <= WHITE_LUMINANCE_THRESHOLD) {
			const w = pdfCanvas.width;
			const h = pdfCanvas.height;
			const allPixels = ctx.getImageData(0, 0, w, h).data;
			const bounds = floodFillBoundary(allPixels, w, h, px, py, FLOOD_FILL_TOLERANCE);
			if (bounds) {
				selection = {
					x: (bounds.x / dpr / canvasCssWidth) * pageWidth,
					y: (bounds.y / dpr / canvasCssHeight) * pageHeight,
					width: (bounds.width / dpr / canvasCssWidth) * pageWidth,
					height: (bounds.height / dpr / canvasCssHeight) * pageHeight,
				};
				onselect?.(selection);
				drawOverlay();
			}
			return;
		}

		isDragging = true;
		dragStart = pos;
		dragEnd = pos;
		selection = null;
		onclear?.();
	}

	function handleMousemove(e: MouseEvent) {
		if (!isDragging) return;
		dragEnd = toCanvas(e);
		drawOverlay();
	}

	function handleMouseup() {
		if (!isDragging || !dragStart || !dragEnd) {
			isDragging = false;
			return;
		}
		isDragging = false;

		const x1 = Math.min(dragStart.x, dragEnd.x);
		const y1 = Math.min(dragStart.y, dragEnd.y);
		const x2 = Math.max(dragStart.x, dragEnd.x);
		const y2 = Math.max(dragStart.y, dragEnd.y);
		const w = x2 - x1;
		const h = y2 - y1;

		if (w < MIN_DRAG_PX || h < MIN_DRAG_PX) {
			dragStart = null;
			dragEnd = null;
			clearOverlay();
			return;
		}

		const { pdfX, pdfY } = canvasToPdf(x1, y1);
		selection = {
			x: pdfX,
			y: pdfY,
			width: (w / canvasCssWidth) * pageWidth,
			height: (h / canvasCssHeight) * pageHeight,
		};
		onselect?.(selection);
		drawOverlay();
		dragStart = null;
		dragEnd = null;
	}

	function clearSelection() {
		selection = null;
		dragStart = null;
		dragEnd = null;
		isDragging = false;
		onclear?.();
		clearOverlay();
	}

	function drawOverlay() {
		const canvas = overlayCanvasEl;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const ctx = canvas.getContext('2d')!;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.save();
		ctx.scale(dpr, dpr);

		if (isDragging && dragStart && dragEnd) {
			const x = Math.min(dragStart.x, dragEnd.x);
			const y = Math.min(dragStart.y, dragEnd.y);
			const w = Math.abs(dragEnd.x - dragStart.x);
			const h = Math.abs(dragEnd.y - dragStart.y);
			ctx.fillStyle = 'rgba(120, 220, 119, 0.15)';
			ctx.fillRect(x, y, w, h);
			ctx.strokeStyle = '#78dc77';
			ctx.lineWidth = 2;
			ctx.setLineDash([6, 4]);
			ctx.strokeRect(x, y, w, h);
		} else if (selection) {
			const x = (selection.x / pageWidth) * canvasCssWidth;
			const y = (selection.y / pageHeight) * canvasCssHeight;
			const w = (selection.width / pageWidth) * canvasCssWidth;
			const h = (selection.height / pageHeight) * canvasCssHeight;
			ctx.fillStyle = 'rgba(120, 220, 119, 0.15)';
			ctx.fillRect(x, y, w, h);
			ctx.strokeStyle = '#78dc77';
			ctx.lineWidth = 2;
			ctx.setLineDash([6, 4]);
			ctx.strokeRect(x, y, w, h);
		}

		ctx.restore();
	}

	function clearOverlay() {
		const canvas = overlayCanvasEl;
		if (!canvas) return;
		const ctx = canvas.getContext('2d')!;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}
</script>

<div
	class="relative w-full bg-surface-container rounded-xl overflow-hidden"
	bind:this={containerEl}
>
	{#if isLoading}
		<div class="flex items-center justify-center h-64">
			<span class="text-label-lg text-on-surface-variant">Rendering PDF...</span>
		</div>
	{/if}
	<div class="relative" style="width: {canvasCssWidth}px; height: {canvasCssHeight}px;">
		<canvas bind:this={pdfCanvasEl} class="absolute top-0 left-0"></canvas>
		<canvas
			bind:this={overlayCanvasEl}
			class="absolute top-0 left-0 cursor-crosshair"
			onmousedown={handleMousedown}
			onmousemove={handleMousemove}
			onmouseup={handleMouseup}
			onmouseleave={handleMouseup}
		></canvas>
	</div>
	{#if selection}
		<button
			class="mt-2 w-full h-8 border border-on-surface-variant/30 text-on-surface-variant rounded-lg text-label-sm active:scale-95 transition-transform"
			onclick={clearSelection}
		>
			Clear selection
		</button>
	{/if}
</div>
