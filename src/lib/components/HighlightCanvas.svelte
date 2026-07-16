<script lang="ts">
	import { floodFillBoundary, getLuminance } from '$lib/workers/flood-fill';
	import type { BoundingBox } from '$lib/workers/types';

	const WHITE_LUMINANCE_THRESHOLD = 225;
	const FLOOD_FILL_TOLERANCE = 30;
	const MIN_DRAG_PX = 3;

	const REGION_COLORS = [
		'#78dc77',
		'#77b8ff',
		'#ffb347',
		'#ff6b6b',
		'#c084fc',
	];

	interface Props {
		pdfFile?: File;
		imageData?: Uint8Array;
		pageWidth: number;
		pageHeight: number;
		onselect?: (boxes: BoundingBox[]) => void;
		onclear?: () => void;
		onpagedimensions?: (width: number, height: number) => void;
	}

	let {
		pdfFile,
		imageData,
		pageWidth,
		pageHeight,
		onselect,
		onclear,
		onpagedimensions
	}: Props = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let pdfCanvasEl: HTMLCanvasElement | undefined = $state();
	let overlayCanvasEl: HTMLCanvasElement | undefined = $state();

	let isDragging = $state(false);
	let dragStart = $state<{ x: number; y: number } | null>(null);
	let dragEnd = $state<{ x: number; y: number } | null>(null);
	let dragShift = $state(false);
	let selections = $state<BoundingBox[]>([]);
	let activeIndex = $state<number | null>(null);
	let isLoading = $state(true);
	let renderGeneration = 0;

	let canvasCssWidth = $state(0);
	let canvasCssHeight = $state(0);

	function colorFor(i: number): string {
		return REGION_COLORS[i % REGION_COLORS.length];
	}

	async function renderFromImageData(
		canvas: HTMLCanvasElement,
		data: Uint8Array,
		gen: number
	) {
		const blob = new Blob([data.slice().buffer as ArrayBuffer]);
		const bitmap = await createImageBitmap(blob);

		if (gen !== renderGeneration) return;

		const dpr = window.devicePixelRatio || 1;
		const containerW = containerEl?.clientWidth ?? 800;
		const scale = containerW / bitmap.width;

		canvasCssWidth = bitmap.width * scale;
		canvasCssHeight = bitmap.height * scale;

		canvas.width = Math.round(canvasCssWidth * dpr);
		canvas.height = Math.round(canvasCssHeight * dpr);
		canvas.style.width = `${canvasCssWidth}px`;
		canvas.style.height = `${canvasCssHeight}px`;

		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		ctx.scale(dpr, dpr);
		ctx.drawImage(bitmap, 0, 0, canvasCssWidth, canvasCssHeight);
		bitmap.close();

		if (gen !== renderGeneration) return;

		if (overlayCanvasEl) {
			overlayCanvasEl.width = canvas.width;
			overlayCanvasEl.height = canvas.height;
			overlayCanvasEl.style.width = canvas.style.width;
			overlayCanvasEl.style.height = canvas.style.height;
		}

		isLoading = false;
	}

	async function renderFromPdf(canvas: HTMLCanvasElement, file: File, gen: number) {
		const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
		const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
		pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

		const buf = await file.arrayBuffer();
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

		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		ctx.scale(dpr, dpr);

		await page.render({ canvas, canvasContext: ctx, viewport: scaledVp }).promise;
		if (gen !== renderGeneration) return;

		const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		let sampled = 0;
		let nonWhite = 0;
		const step = Math.max(1, Math.floor(imgData.length / (4 * 5000)));
		for (let i = 0; i < imgData.length; i += 4 * step) {
			sampled++;
			const lum = imgData[i] * 0.299 + imgData[i + 1] * 0.587 + imgData[i + 2] * 0.114;
			if (lum < 240) nonWhite++;
		}
		const hasContent = sampled > 0 && nonWhite / sampled > 0.01;

		if (!hasContent && imageData) {
			await renderFromImageData(canvas, imageData, gen);
			return;
		}

		if (overlayCanvasEl) {
			overlayCanvasEl.width = canvas.width;
			overlayCanvasEl.height = canvas.height;
			overlayCanvasEl.style.width = canvas.style.width;
			overlayCanvasEl.style.height = canvas.style.height;
		}

		isLoading = false;
	}

	$effect(() => {
		void pdfFile;
		void imageData;
		const canvas = pdfCanvasEl;
		if (!canvas) return;
		const gen = ++renderGeneration;
		isLoading = true;
		selections = [];
		activeIndex = null;
		onclear?.();

		if (imageData) {
			renderFromImageData(canvas, imageData, gen);
		} else if (pdfFile) {
			renderFromPdf(canvas, pdfFile, gen);
		}
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

	function isInsideSelection(
		cssX: number,
		cssY: number,
		box: BoundingBox
	): boolean {
		const nx = (box.x / pageWidth) * canvasCssWidth;
		const ny = (box.y / pageHeight) * canvasCssHeight;
		const nw = (box.width / pageWidth) * canvasCssWidth;
		const nh = (box.height / pageHeight) * canvasCssHeight;
		return cssX >= nx && cssX <= nx + nw && cssY >= ny && cssY <= ny + nh;
	}

	function findSelectionAt(cssX: number, cssY: number): number {
		for (let i = selections.length - 1; i >= 0; i--) {
			if (isInsideSelection(cssX, cssY, selections[i])) return i;
		}
		return -1;
	}

	function addSelection(box: BoundingBox) {
		selections = [...selections, box];
		activeIndex = selections.length - 1;
		onselect?.(selections);
		drawOverlay();
	}

	function replaceSelections(box: BoundingBox) {
		selections = [box];
		activeIndex = 0;
		onselect?.(selections);
		drawOverlay();
	}

	function removeSelection(index: number) {
		selections = selections.filter((_, i) => i !== index);
		activeIndex = selections.length > 0 ? Math.min(index, selections.length - 1) : null;
		onselect?.(selections);
		drawOverlay();
	}

	function handleMousedown(e: MouseEvent) {
		if (isLoading) return;
		const pos = toCanvas(e);
		if (!pos) return;

		const pdfCanvas = pdfCanvasEl;
		if (!pdfCanvas) return;
		const dpr = window.devicePixelRatio || 1;
		const ctx = pdfCanvas.getContext('2d', { willReadFrequently: true })!;
		const px = Math.floor(pos.x * dpr);
		const py = Math.floor(pos.y * dpr);
		const pixel = ctx.getImageData(px, py, 1, 1).data;
		const lum = getLuminance(pixel, 0);

		const existingIdx = findSelectionAt(pos.x, pos.y);

		if (existingIdx !== -1 && !e.shiftKey) {
			activeIndex = existingIdx;
			drawOverlay();
			return;
		}

		if (lum <= WHITE_LUMINANCE_THRESHOLD) {
			const w = pdfCanvas.width;
			const h = pdfCanvas.height;
			const allPixels = ctx.getImageData(0, 0, w, h).data;
			const bounds = floodFillBoundary(allPixels, w, h, px, py, FLOOD_FILL_TOLERANCE);
			if (bounds) {
				const box: BoundingBox = {
					x: (bounds.x / dpr / canvasCssWidth) * pageWidth,
					y: (bounds.y / dpr / canvasCssHeight) * pageHeight,
					width: (bounds.width / dpr / canvasCssWidth) * pageWidth,
					height: (bounds.height / dpr / canvasCssHeight) * pageHeight,
				};
				if (e.shiftKey) {
					addSelection(box);
				} else {
					replaceSelections(box);
				}
			}
			return;
		}

		isDragging = true;
		dragStart = pos;
		dragEnd = pos;
		dragShift = e.shiftKey;
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
			drawOverlay();
			return;
		}

		const { pdfX, pdfY } = canvasToPdf(x1, y1);
		const box: BoundingBox = {
			x: pdfX,
			y: pdfY,
			width: (w / canvasCssWidth) * pageWidth,
			height: (h / canvasCssHeight) * pageHeight,
		};

		dragStart = null;
		dragEnd = null;

		if (dragShift) {
			addSelection(box);
		} else {
			replaceSelections(box);
		}
	}

	function drawOverlay() {
		const canvas = overlayCanvasEl;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const ctx = canvas.getContext('2d')!;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.save();
		ctx.scale(dpr, dpr);

		selections.forEach((sel, i) => {
			const isActive = i === activeIndex;
			const color = colorFor(i);
			const x = (sel.x / pageWidth) * canvasCssWidth;
			const y = (sel.y / pageHeight) * canvasCssHeight;
			const w = (sel.width / pageWidth) * canvasCssWidth;
			const h = (sel.height / pageHeight) * canvasCssHeight;

			ctx.fillStyle = isActive ? `${color}30` : `${color}18`;
			ctx.fillRect(x, y, w, h);

			ctx.strokeStyle = color;
			ctx.lineWidth = isActive ? 2.5 : 1.5;
			ctx.setLineDash(isActive ? [] : [4, 3]);
			ctx.strokeRect(x, y, w, h);
			ctx.setLineDash([]);

			const label = `R${i + 1}`;
			const pad = 3;
			const fontSize = 11;
			ctx.font = `${fontSize}px sans-serif`;
			const tw = ctx.measureText(label).width;

			ctx.fillStyle = color;
			ctx.fillRect(x, y, tw + pad * 2, fontSize + pad * 2);
			ctx.fillStyle = '#000';
			ctx.fillText(label, x + pad, y + fontSize + pad);
		});

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
			ctx.setLineDash([]);
		}

		ctx.restore();
	}

	function clearAll() {
		selections = [];
		activeIndex = null;
		isDragging = false;
		dragStart = null;
		dragEnd = null;
		onclear?.();
		drawOverlay();
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
	{#if selections.length > 0}
		<div class="p-3 space-y-2">
			{#each selections as sel, i}
				{@const color = colorFor(i)}
				<div
					class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-label-sm transition-colors"
					style="border-color: {color}; background-color: {color}12;"
					class:opacity-80={activeIndex !== null && activeIndex !== i}
					onclick={() => { activeIndex = i; drawOverlay(); }}
				>
					<span
						class="inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold text-black"
						style="background-color: {color}"
					>{i + 1}</span>
					<span class="text-on-surface-variant flex-1">
						({sel.x.toFixed(0)}, {sel.y.toFixed(0)}) {sel.width.toFixed(0)}×{sel.height.toFixed(0)}
					</span>
					<button
						class="w-5 h-5 flex items-center justify-center rounded hover:bg-surface-container text-on-surface-variant/60 hover:text-error text-xs cursor-pointer border-none"
						onclick={() => removeSelection(i)}
					>✕</button>
				</div>
			{/each}
			<div class="flex gap-2">
				<button
					class="flex-1 h-8 border border-on-surface-variant/30 text-on-surface-variant rounded-lg text-label-sm active:scale-95 transition-transform cursor-pointer"
					onclick={clearAll}
				>
					Clear all
				</button>
			</div>
		</div>
	{/if}
</div>
