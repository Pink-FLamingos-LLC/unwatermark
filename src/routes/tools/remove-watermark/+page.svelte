<script lang="ts">
	import Dropzone from '$lib/components/Dropzone.svelte';
	import DetectionMethodSelector from '$lib/components/DetectionMethodSelector.svelte';
	import HighlightCanvas from '$lib/components/HighlightCanvas.svelte';
	import { processPdfVisual } from '$lib/workers/visual-processor';
	import type { WorkerMessage, PdfDebugInfo, DetectionMethod, BoundingBox } from '$lib/workers/types';
	import { PDFDocument } from 'pdf-lib';

	let stage = $state<string | null>(null);
	let percent = $state(0);
	let error = $state<string | null>(null);
	let isProcessing = $state(false);
	let worker = $state<Worker | null>(null);
	let debugMode = $state(false);
	let debugInfo = $state<PdfDebugInfo | null>(null);
	let detectionMethod = $state<DetectionMethod>('visual');
	let uploadedFile = $state<File | null>(null);
	let advancedMode = $state(false);
	let manualSelection = $state<BoundingBox | null>(null);
	let pdfPageWidth = $state(612);
	let pdfPageHeight = $state(792);
	let autoDownload = $state(false);
	let processedPdf = $state<Uint8Array | null>(null);
	let processedFilename = $state<string>('');
	let previewCanvasEl = $state<HTMLCanvasElement | undefined>();
	let isRenderingPreview = $state(false);
	let extractedImageBytes = $state<Uint8Array | null>(null);
	let isExtractingImage = $state(false);

	function deriveCleanFilename(originalName: string): string {
		const lastDot = originalName.lastIndexOf('.');
		if (lastDot <= 0) return `${originalName}_clean.pdf`;
		return `${originalName.substring(0, lastDot)}_clean.pdf`;
	}

	function downloadPdf(data: Uint8Array, filename: string) {
		const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function resetState() {
		isProcessing = false;
		stage = null;
		percent = 0;
		worker?.terminate();
		worker = null;
	}

	function cancel() {
		resetState();
	}

	function handleMethodChange(method: DetectionMethod) {
		detectionMethod = method;
		processedPdf = null;
		if (method !== 'visual') {
			advancedMode = false;
			manualSelection = null;
		}
		if (uploadedFile && method === 'structural') {
			processFile(uploadedFile);
		}
		if (uploadedFile && method === 'visual' && !advancedMode) {
			processFile(uploadedFile);
		}
	}

	async function processFile(file: File, selection?: BoundingBox) {
		error = null;
		debugInfo = null;
		processedPdf = null;
		isProcessing = true;
		stage = 'Loading PDF...';
		percent = 0;

		const pdfBuffer = await file.arrayBuffer();

		if (detectionMethod === 'visual') {
			try {
				const result = await processPdfVisual(
					pdfBuffer,
					selection ?? null,
					(s, p) => { stage = s; percent = p; },
					(info) => { debugInfo = info; }
				);
				const filename = deriveCleanFilename(file.name);
				resetState();
				processedPdf = result;
				processedFilename = filename;
				if (autoDownload) {
					downloadPdf(result, filename);
				}
			} catch (err) {
				error = err instanceof Error ? err.message : 'Visual detection failed';
				resetState();
			}
			return;
		}

		const w = new Worker(
			new URL('$lib/workers/structural-detector.worker.ts', import.meta.url),
			{ type: 'module' }
		);
		worker = w;

		w.onmessage = (e: MessageEvent<WorkerMessage>) => {
			const msg = e.data;
			if (msg.type === 'progress') {
				stage = msg.stage;
				percent = msg.percent;
			} else if (msg.type === 'debug') {
				debugInfo = msg.info;
			} else if (msg.type === 'result') {
				const filename = deriveCleanFilename(file.name);
				resetState();
				processedPdf = msg.processedPdf;
				processedFilename = filename;
				if (autoDownload) {
					downloadPdf(msg.processedPdf, filename);
				}
			} else if (msg.type === 'error') {
				error = msg.message;
				resetState();
			}
		};

		w.onerror = (e) => {
			error = e.message || 'Worker error';
			resetState();
		};

		w.postMessage({ pdfBuffer });
	}

	async function renderPreview(data: Uint8Array) {
		const canvas = previewCanvasEl;
		if (!canvas) return;
		isRenderingPreview = true;

		try {
			const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
			const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
			pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

			const buf = data.slice().buffer as ArrayBuffer;
			const doc = await pdfjsLib.getDocument({ data: buf }).promise;
			const page = await doc.getPage(1);
			const vp = page.getViewport({ scale: 1 });

			const dpr = window.devicePixelRatio || 1;
			const containerW = canvas.parentElement?.clientWidth ?? 600;
			const scale = containerW / vp.width;
			const scaledVp = page.getViewport({ scale });

			canvas.width = Math.round(scaledVp.width * dpr);
			canvas.height = Math.round(scaledVp.height * dpr);
			canvas.style.width = `${scaledVp.width}px`;
			canvas.style.height = `${scaledVp.height}px`;

			const ctx = canvas.getContext('2d')!;
			ctx.scale(dpr, dpr);

			await page.render({ canvas, canvasContext: ctx, viewport: scaledVp }).promise;
		} catch (err) {
			console.error('Preview render error:', err);
		} finally {
			isRenderingPreview = false;
		}
	}

	$effect(() => {
		if (processedPdf && previewCanvasEl) {
			renderPreview(processedPdf);
		}
	});

	async function handleFile(file: File) {
		uploadedFile = file;
		error = null;
		manualSelection = null;
		processedPdf = null;
		if (detectionMethod === 'visual' && advancedMode) {
			return;
		}
		processFile(file);
	}

	function handleSelection(box: BoundingBox) {
		manualSelection = box;
	}

	function handleSelectionClear() {
		manualSelection = null;
	}

	function handlePageDimensions(width: number, height: number) {
		pdfPageWidth = width;
		pdfPageHeight = height;
	}

	function processWithSelection() {
		if (!uploadedFile || !manualSelection) return;
		processFile(uploadedFile, manualSelection);
	}

	function handleDownload() {
		if (processedPdf) {
			downloadPdf(processedPdf, processedFilename);
		}
	}

	function startOver() {
		processedPdf = null;
		uploadedFile = null;
		error = null;
		manualSelection = null;
		extractedImageBytes = null;
	}

	async function extractImage() {
		if (!uploadedFile) return;
		isExtractingImage = true;
		try {
			const buf = await uploadedFile.arrayBuffer();
			const pdfDoc = await PDFDocument.load(buf, { parseSpeed: 0 });
			const page = pdfDoc.getPages()[0];
			if (!page) return;
			const resources = (page.node as any).Resources?.();
			if (!resources) return;
			let xobjectDict: any;
			for (const [key, value] of resources.entries()) {
				const name = typeof key === 'string' ? key : (key as any).decodeText?.() ?? String(key);
				if (name.replace(/^\//, '') === 'XObject') {
					xobjectDict = value;
					break;
				}
			}
			if (!xobjectDict?.entries) return;
			for (const [, value] of xobjectDict.entries()) {
				const stream = (pdfDoc.context as any).lookup?.(value) ?? value;
				if (stream?.getUnencodedContents) {
					const bytes = stream.getUnencodedContents();
					if (bytes && bytes.length > 100) {
						extractedImageBytes = bytes;
						isExtractingImage = false;
						return;
					}
				}
				if (stream?.getContents) {
					const bytes = stream.getContents();
					if (bytes && bytes.length > 100) {
						extractedImageBytes = bytes;
						isExtractingImage = false;
						return;
					}
				}
			}
		} catch (err) {
			console.error('Image extraction error:', err);
		}
		isExtractingImage = false;
	}

	$effect(() => {
		if (advancedMode && uploadedFile && !extractedImageBytes) {
			extractImage();
		}
		if (!advancedMode) {
			extractedImageBytes = null;
		}
	});
</script>

<svelte:head>
	<title>Remove Watermark — Unwatermark</title>
</svelte:head>

<main class="p-4 max-w-2xl mx-auto">
	<h1 class="text-headline-lg font-bold text-on-surface mb-2">Remove Watermark</h1>
	<p class="text-body-md text-on-surface-variant mb-6">Upload a PDF to remove the watermark from the first page.</p>

	{#if isProcessing && stage}
		<div class="bg-surface-charcoal border border-[#FFFFFF10] rounded-xl p-4 mb-4">
			<div class="flex justify-between items-center mb-2">
				<span class="text-label-lg text-on-surface">{stage}</span>
				<span class="text-label-sm text-on-surface-variant">{percent}%</span>
			</div>
			<div class="w-full h-2 bg-surface-container rounded-full overflow-hidden mb-4">
				<div
					class="h-full bg-primary rounded-full transition-all duration-300"
					style="width: {percent}%"
				></div>
			</div>
			<button
				class="w-full h-12 border-2 border-error text-error rounded-lg text-label-lg font-semibold active:scale-95 transition-transform"
				onclick={cancel}
			>
				Cancel
			</button>
		</div>
	{:else}
		<Dropzone onfile={handleFile} />
		<div class="mt-4">
			<label class="flex items-center gap-2 cursor-pointer">
				<input type="checkbox" bind:checked={autoDownload} class="w-5 h-5 accent-primary" />
				<span class="text-label-lg text-on-surface-variant">Auto-download after processing</span>
			</label>
		</div>
		{#if uploadedFile && !isProcessing}
			<div class="mt-4">
				<DetectionMethodSelector selected={detectionMethod} onchange={handleMethodChange} />
			</div>
			{#if detectionMethod === 'visual'}
				<div class="mt-4">
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={advancedMode} class="w-5 h-5 accent-primary" />
						<span class="text-label-lg text-on-surface-variant">Advanced mode</span>
					</label>
					<p class="text-label-sm text-on-surface-variant/70 mt-1 ml-7">
						Manually highlight the watermark region on the rendered page.
					</p>
				</div>
			{/if}
			{#if advancedMode && detectionMethod === 'visual'}
				<div class="mt-4">
					{#if isExtractingImage}
						<div class="flex items-center justify-center h-32 bg-surface-container rounded-xl">
							<span class="text-label-lg text-on-surface-variant">Extracting image...</span>
						</div>
					{:else if extractedImageBytes}
						<HighlightCanvas
							imageData={extractedImageBytes}
							pageWidth={pdfPageWidth}
							pageHeight={pdfPageHeight}
							onselect={handleSelection}
							onclear={handleSelectionClear}
							onpagedimensions={handlePageDimensions}
						/>
					{:else if uploadedFile}
						<HighlightCanvas
							pdfFile={uploadedFile}
							pageWidth={pdfPageWidth}
							pageHeight={pdfPageHeight}
							onselect={handleSelection}
							onclear={handleSelectionClear}
							onpagedimensions={handlePageDimensions}
						/>
					{/if}
				</div>
				{#if manualSelection}
					<button
						class="mt-4 w-full h-12 bg-primary text-on-primary rounded-lg text-label-lg font-semibold active:scale-95 transition-transform"
						onclick={processWithSelection}
					>
						Process
					</button>
				{/if}
			{/if}
		{/if}

		{#if processedPdf}
			<div class="mt-4 bg-surface-charcoal border border-[#FFFFFF10] rounded-xl p-4">
				<h2 class="text-label-lg font-semibold text-on-surface mb-3">Preview</h2>
				<div class="flex justify-center bg-surface-container rounded-lg overflow-hidden p-2">
					{#if isRenderingPreview}
						<div class="flex items-center justify-center h-64">
							<span class="text-label-lg text-on-surface-variant">Rendering preview...</span>
						</div>
					{/if}
					<canvas bind:this={previewCanvasEl} class="max-w-full" class:hidden={isRenderingPreview}></canvas>
				</div>
				<div class="mt-4 flex gap-3">
					<button
						class="flex-1 h-12 bg-primary text-on-primary rounded-lg text-label-lg font-semibold active:scale-95 transition-transform"
						onclick={handleDownload}
					>
						Download {processedFilename}
					</button>
					<button
						class="h-12 px-4 border border-on-surface-variant/30 text-on-surface-variant rounded-lg text-label-lg active:scale-95 transition-transform"
						onclick={startOver}
					>
						Start over
					</button>
				</div>
			</div>
		{/if}
	{/if}

	{#if error}
		<div class="bg-error-container border border-error/30 rounded-xl p-4 mt-2" role="alert">
			<p class="text-label-sm text-on-error-container mb-2">{error}</p>
			{#if debugInfo && debugInfo.xobjectNames.length > 0 && debugInfo.imagePlacements.length === 0}
				<p class="text-label-sm text-on-error-container/80">
					This PDF has {debugInfo.xobjectNames.length} image(s) but the watermark appears to be embedded in the image pixels, not as a separate object.
					Try Visual detection to handle this type of PDF.
				</p>
			{/if}
			{#if uploadedFile && !isProcessing}
				{@const otherMethod = detectionMethod === 'structural' ? 'visual' : 'structural'}
				<button
					class="mt-3 w-full h-10 border border-on-error-container/30 text-on-error-container rounded-lg text-label-lg font-semibold active:scale-95 transition-transform"
					onclick={() => handleMethodChange(otherMethod)}
				>
					Try {otherMethod === 'structural' ? 'Structural' : 'Visual'} detection
				</button>
			{/if}
		</div>
	{/if}

	<div class="mt-4">
		<label class="flex items-center gap-2 cursor-pointer">
			<input type="checkbox" bind:checked={debugMode} class="w-5 h-5 accent-primary" />
			<span class="text-label-lg text-on-surface-variant">Debug mode</span>
		</label>
	</div>

	{#if debugMode && debugInfo}
		<div class="bg-surface-charcoal border border-[#FFFFFF10] rounded-xl p-4 mt-4">
			<h2 class="text-label-lg font-semibold text-on-surface mb-3">PDF Debug Info</h2>

			<div class="space-y-3 text-label-sm">
				<div>
					<span class="text-on-surface-variant">Pages:</span>
					<span class="text-on-surface ml-2">{debugInfo.pageCount}</span>
				</div>
				<div>
					<span class="text-on-surface-variant">Page size:</span>
					<span class="text-on-surface ml-2">{debugInfo.pageWidth.toFixed(1)} x {debugInfo.pageHeight.toFixed(1)}</span>
				</div>

				{#if !debugInfo.visual}
					<div>
						<span class="text-on-surface-variant">Content stream:</span>
						<span class="text-on-surface ml-2">{debugInfo.contentStreamLength} chars</span>
						{#if debugInfo.contentStreamRaw}
							<pre class="mt-1 p-2 bg-surface-container rounded text-label-sm text-on-surface-variant overflow-x-auto">{debugInfo.contentStreamRaw}</pre>
						{/if}
					</div>

					{#if Object.keys(debugInfo.resources).length > 0}
						<div>
							<span class="text-on-surface-variant">Resources:</span>
							<ul class="ml-4 mt-1 space-y-1">
								{#each Object.entries(debugInfo.resources) as [name, entries] (name)}
									<li class="text-on-surface">
										/{name}
										{#if entries.length > 0}
											<span class="text-on-surface-variant"> ({entries.length})</span>
											{#if debugMode}
												<ul class="ml-4 text-on-surface-variant">
													{#each entries as entry (entry)}
														<li>/{entry}</li>
													{/each}
												</ul>
											{/if}
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if debugInfo.xobjectNames.length > 0}
						<div>
							<span class="text-on-surface-variant">XObjects:</span>
							<ul class="ml-4 mt-1 space-y-1">
								{#each debugInfo.xobjectNames as name (name)}
									<li class="text-on-surface">
										/{name}
										<span class="text-on-surface-variant"> ({debugInfo.xobjectTypes[name] ?? 'unknown'})</span>
									</li>
								{/each}
							</ul>
						</div>
					{:else}
						<div class="text-meeple-yellow">No XObjects found</div>
					{/if}

					{#if debugInfo.imagePlacements.length > 0}
						<div>
							<span class="text-on-surface-variant">Image placements ({debugInfo.imagePlacements.length}):</span>
							<ul class="ml-4 mt-1 space-y-1">
								{#each debugInfo.imagePlacements as img (img.name)}
									<li class="text-on-surface">
										/{img.name} — ({img.box.x.toFixed(1)}, {img.box.y.toFixed(1)}) {img.box.width.toFixed(1)}x{img.box.height.toFixed(1)}
									</li>
								{/each}
							</ul>
						</div>
					{:else}
						<div class="text-meeple-yellow">No image placements found in content stream</div>
					{/if}

					{#if debugInfo.detectionResult}
						<div>
							<span class="text-on-surface-variant">Detection:</span>
							{#if debugInfo.detectionResult.watermark}
								<div class="ml-4 text-primary">
									Watermark: ({debugInfo.detectionResult.watermark.x.toFixed(1)}, {debugInfo.detectionResult.watermark.y.toFixed(1)}) {debugInfo.detectionResult.watermark.width.toFixed(1)}x{debugInfo.detectionResult.watermark.height.toFixed(1)}
								</div>
							{:else}
								<div class="ml-4 text-meeple-yellow">No watermark detected</div>
							{/if}
							<div class="ml-4 text-on-surface-variant">
								Grid images: {debugInfo.detectionResult.gridImages.length}
							</div>
						</div>
					{/if}
				{/if}

				{#if debugInfo.visual}
					<div>
						<span class="text-on-surface-variant">Visual Detection:</span>
						<div class="ml-4 space-y-1">
							<div class="text-on-surface">
								Method: <span class="text-primary">{debugInfo.visual.detectionMethod}</span>
							</div>
							<div class="text-on-surface-variant">
								Render scale: {debugInfo.visual.renderScale}x
							</div>
							<div class="text-on-surface-variant">
								Canvas: {debugInfo.visual.canvasWidth} x {debugInfo.visual.canvasHeight}
							</div>
							<div class="text-on-surface">
								Watermark: ({debugInfo.visual.watermarkBox.x}, {debugInfo.visual.watermarkBox.y}) {debugInfo.visual.watermarkBox.width}x{debugInfo.visual.watermarkBox.height}
							</div>
							<div class="text-on-surface-variant">
								Background: rgb({debugInfo.visual.bgColor.r}, {debugInfo.visual.bgColor.g}, {debugInfo.visual.bgColor.b})
							</div>
							{#if debugInfo.visual.imageFormat !== 'pending'}
								<div class="text-on-surface-variant">
									Image: {debugInfo.visual.imageFormat.toUpperCase()} ({(debugInfo.visual.imageSizeBytes / 1024).toFixed(1)} KB)
								</div>
							{/if}
							{#if debugInfo.visual.diagnostic}
								<div class="text-on-surface-variant">
									{debugInfo.visual.diagnostic}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</main>
