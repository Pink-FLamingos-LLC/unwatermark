<script lang="ts">
	import Dropzone from '$lib/components/Dropzone.svelte';
</script>

<svelte:head>
	<title>Remove Watermark — Unwatermark</title>
</svelte:head>

<main class="p-4 max-w-2xl mx-auto">
	<h1 class="text-headline-lg font-bold text-on-surface mb-2">Remove Watermark</h1>
	<p class="text-body-md text-on-surface-variant mb-6">Upload a PDF to remove the watermark from the first page.</p>

	<Dropzone />
</main>
