<script lang="ts">
	import Dropzone from '$lib/components/Dropzone.svelte';
	import DetectionMethodSelector from '$lib/components/DetectionMethodSelector.svelte';
	import type { WorkerMessage, PdfDebugInfo, DetectionMethod } from '$lib/workers/types';

	let stage = $state<string | null>(null);
	let percent = $state(0);
	let error = $state<string | null>(null);
	let isProcessing = $state(false);
	let worker = $state<Worker | null>(null);
	let debugMode = $state(false);
	let debugInfo = $state<PdfDebugInfo | null>(null);
	let detectionMethod = $state<DetectionMethod>('structural');
	let uploadedFile = $state<File | null>(null);

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
		if (uploadedFile && error) {
			processFile(uploadedFile);
		}
	}

	async function processFile(file: File) {
		error = null;
		debugInfo = null;
		isProcessing = true;
		stage = 'Loading PDF...';
		percent = 0;

		const w = new Worker(
			new URL('$lib/workers/structural-detector.worker.ts', import.meta.url),
			{ type: 'module' }
		);
		worker = w;

		const pdfBuffer = await file.arrayBuffer();

		w.onmessage = (e: MessageEvent<WorkerMessage>) => {
			const msg = e.data;
			if (msg.type === 'progress') {
				stage = msg.stage;
				percent = msg.percent;
			} else if (msg.type === 'debug') {
				debugInfo = msg.info;
			} else if (msg.type === 'result') {
				const filename = deriveCleanFilename(file.name);
				downloadPdf(msg.processedPdf, filename);
				resetState();
			} else if (msg.type === 'error') {
				error = msg.message;
				resetState();
			}
		};

		w.onerror = (e) => {
			error = e.message || 'Worker error';
			resetState();
		};

		w.postMessage({ pdfBuffer, detectionMethod });
	}

	async function handleFile(file: File) {
		uploadedFile = file;
		processFile(file);
	}
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
		{#if uploadedFile && !isProcessing}
			<div class="mt-4">
				<DetectionMethodSelector selected={detectionMethod} onchange={handleMethodChange} />
			</div>
		{/if}
	{/if}

	{#if error}
		<div class="bg-error-container border border-error/30 rounded-xl p-4 mt-2" role="alert">
			<p class="text-label-sm text-on-error-container mb-2">{error}</p>
			{#if debugInfo && debugInfo.xobjectNames.length > 0 && debugInfo.imagePlacements.length === 0}
				<p class="text-label-sm text-on-error-container/80">
					This PDF has {debugInfo.xobjectNames.length} image(s) but the watermark appears to be embedded in the image pixels, not as a separate object.
					Visual detection (coming soon) will handle this type of PDF.
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
			</div>
		</div>
	{/if}
</main>
