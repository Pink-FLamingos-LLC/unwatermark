<script lang="ts">
	interface Props {
		onfile?: (file: File) => void;
	}

	let { onfile }: Props = $props();

	let file = $state.raw<File | null>(null);
	let error = $state<string | null>(null);
	let isDragging = $state(false);
	let fileInput: HTMLInputElement;

	const MAX_FILE_SIZE = 50 * 1024 * 1024;

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function validateFile(f: File): string | null {
		if (f.type !== 'application/pdf') {
			return 'Only PDF files are accepted';
		}
		if (f.size > MAX_FILE_SIZE) {
			return `File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}`;
		}
		return null;
	}

	function handleFile(f: File) {
		const validationError = validateFile(f);
		if (validationError) {
			error = validationError;
			file = null;
			return;
		}
		error = null;
		file = f;
		onfile?.(f);
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
		const droppedFile = e.dataTransfer?.files[0];
		if (droppedFile) {
			handleFile(droppedFile);
		}
	}

	function handleDragover(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragleave(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const selectedFile = input.files?.[0];
		if (selectedFile) {
			handleFile(selectedFile);
		}
		input.value = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			fileInput.click();
		}
	}
</script>

<div
	class="flex flex-col items-center justify-center min-h-[200px] p-4 bg-surface-charcoal border-2 border-dashed border-[#FFFFFF10] rounded-xl cursor-pointer transition-colors hover:border-primary hover:bg-surface-container focus-visible:border-primary focus-visible:bg-surface-container focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 {isDragging ? 'border-secondary bg-surface-container border-solid' : ''}"
	role="button"
	tabindex="0"
	aria-label="Upload PDF file. Click or drag and drop."
	ondrop={handleDrop}
	ondragover={handleDragover}
	ondragleave={handleDragleave}
	onclick={() => fileInput.click()}
	onkeydown={handleKeydown}
>
	<input
		bind:this={fileInput}
		type="file"
		accept="application/pdf"
		class="hidden"
		onchange={handleFileInput}
	/>

	{#if file}
		<div class="flex items-center gap-3 w-full">
			<svg class="w-12 h-12 text-primary shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
				<polyline points="14 2 14 8 20 8"></polyline>
			</svg>
			<div class="flex flex-col min-w-0">
				<span class="text-label-lg font-semibold text-on-surface truncate">{file.name}</span>
				<span class="text-label-sm text-on-surface-variant">{formatFileSize(file.size)}</span>
			</div>
		</div>
	{:else}
		<svg class="w-12 h-12 text-on-surface-variant mb-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
			<polyline points="17 8 12 3 7 8"></polyline>
			<line x1="12" y1="3" x2="12" y2="15"></line>
		</svg>
		<p class="text-body-md text-on-surface mb-1">Click or drag and drop a PDF</p>
		<p class="text-label-sm text-on-surface-variant">PDF files only, up to 50MB</p>
	{/if}
</div>

{#if error}
	<p class="text-label-sm text-on-error-container bg-error-container px-3 py-2 rounded-lg mt-2" role="alert">{error}</p>
{/if}
