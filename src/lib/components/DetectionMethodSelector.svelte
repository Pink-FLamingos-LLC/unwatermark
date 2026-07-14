<script lang="ts">
	import type { DetectionMethod } from '$lib/workers/types';

	interface Props {
		selected: DetectionMethod;
		onchange?: (method: DetectionMethod) => void;
	}

	let { selected, onchange }: Props = $props();

	const methods: { id: DetectionMethod; title: string; description: string }[] = [
		{
			id: 'structural',
			title: 'Structural',
			description: 'Parses PDF objects to find the watermark. Fast and works for most card sheets.'
		},
		{
			id: 'visual',
			title: 'Visual',
			description: 'Renders the page and analyzes pixels. Handles edge cases where PDF structure is unusual.'
		}
	];

	function selectMethod(method: DetectionMethod) {
		if (method !== selected) {
			onchange?.(method);
		}
	}

	function handleKeydown(e: KeyboardEvent, method: DetectionMethod) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			selectMethod(method);
		}
	}
</script>

<div class="space-y-3">
	<p class="text-label-lg text-on-surface-variant">Detection method</p>
	<div class="grid grid-cols-2 gap-3">
		{#each methods as method (method.id)}
			{@const isActive = selected === method.id}
			<div
				class={[
					'flex flex-col gap-1 p-4 rounded-xl border cursor-pointer transition-all',
					'active:scale-[0.98]',
					isActive
						? 'bg-primary/10 border-primary'
						: 'bg-surface-charcoal border-[#FFFFFF10] hover:border-on-surface-variant'
				]}
				role="radio"
				aria-checked={isActive}
				tabindex="0"
				onclick={() => selectMethod(method.id)}
				onkeydown={(e) => handleKeydown(e, method.id)}
			>
				<div class="flex items-center gap-2">
					<div
						class={[
							'w-4 h-4 rounded-full border-2 flex items-center justify-center',
							isActive ? 'border-primary' : 'border-on-surface-variant'
						]}
					>
						{#if isActive}
							<div class="w-2 h-2 rounded-full bg-primary"></div>
						{/if}
					</div>
					<span class="text-headline-md font-semibold {isActive ? 'text-primary' : 'text-on-surface'}">
						{method.title}
					</span>
				</div>
				<p class="text-label-sm text-on-surface-variant mt-1">
					{method.description}
				</p>
			</div>
		{/each}
	</div>
</div>
