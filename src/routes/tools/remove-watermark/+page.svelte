<script lang="ts">
	import Dropzone from '$lib/components/Dropzone.svelte';
	import type { WorkerMessage } from '$lib/workers/types';

	let stage = $state<string | null>(null);
	let percent = $state(0);
	let error = $state<string | null>(null);
	let isProcessing = $state(false);
	let worker = $state<Worker | null>(null);

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

	async function handleFile(file: File) {
		error = null;
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

		w.postMessage({ pdfBuffer });
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
	{/if}

	{#if error}
		<p class="text-label-sm text-on-error-container bg-error-container px-3 py-2 rounded-lg mt-2" role="alert">{error}</p>
	{/if}
</main>
