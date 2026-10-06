<script lang="ts" module>
	export interface UploadedItem {
		id: string;
		name: string;
		size: number;
		preview: string;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import X from '@lucide/svelte/icons/x';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { formatBytes } from '$lib/shared/text';
	import { cn } from '$lib/utils';

	/**
	 * Screenshot uploader: click to browse, drag & drop, or paste from the clipboard anywhere on
	 * the page. Images upload immediately as pending attachments and are linked on submit.
	 * Without JavaScript it degrades to a regular multi-file input.
	 */
	interface Props {
		name?: string;
		items?: UploadedItem[];
		maxFiles: number;
		maxSize: number;
		accept: string[];
		compact?: boolean;
		label?: string;
		onchange?: (items: UploadedItem[]) => void;
	}

	let {
		name = 'attachmentIds',
		items = $bindable([]),
		maxFiles,
		maxSize,
		accept,
		compact = false,
		label = 'Screenshots',
		onchange
	}: Props = $props();

	interface Pending {
		key: string;
		name: string;
		preview: string;
		error?: string;
	}

	let enhanced = $state(false);
	let dragging = $state(false);
	let uploading = $state<Pending[]>([]);
	let errors = $state<string[]>([]);
	let announcement = $state('');
	let fileInput: HTMLInputElement | undefined = $state();
	const acceptAttr = $derived(accept.join(','));

	onMount(() => {
		enhanced = true;
		const onPaste = (e: ClipboardEvent) => {
			const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
			if (!files.length) return;
			e.preventDefault();
			void addFiles(files, 'pasted');
		};
		window.addEventListener('paste', onPaste);
		return () => window.removeEventListener('paste', onPaste);
	});

	function emit() {
		onchange?.(items);
	}

	async function upload(file: File, pending: Pending) {
		const body = new FormData();
		body.append('file', file, file.name || 'screenshot.png');
		try {
			const res = await fetch('/api/uploads', { method: 'POST', body });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.message ?? 'Upload failed');
			items = [...items, { id: data.id, name: data.name, size: data.size, preview: pending.preview }];
			announcement = `${data.name} uploaded`;
			emit();
		} catch (err) {
			URL.revokeObjectURL(pending.preview);
			errors = [...errors, err instanceof Error ? err.message : 'Upload failed'];
			announcement = `Upload of ${pending.name} failed`;
		} finally {
			uploading = uploading.filter((u) => u.key !== pending.key);
		}
	}

	async function addFiles(files: File[], verb = 'added') {
		errors = [];
		const room = maxFiles - items.length - uploading.length;
		if (room <= 0) {
			errors = [`You can attach up to ${maxFiles} images.`];
			return;
		}
		const accepted: File[] = [];
		for (const file of files.slice(0, room)) {
			if (!accept.includes(file.type)) errors.push(`“${file.name}” is not a supported image type.`);
			else if (file.size > maxSize) errors.push(`“${file.name}” is larger than ${formatBytes(maxSize)}.`);
			else accepted.push(file);
		}
		if (files.length > room) errors.push(`Only ${maxFiles} images can be attached.`);
		errors = [...errors];
		announcement = accepted.length ? `${accepted.length} image${accepted.length > 1 ? 's' : ''} ${verb}, uploading` : announcement;
		await Promise.all(
			accepted.map((file) => {
				const pending: Pending = { key: crypto.randomUUID(), name: file.name || 'Screenshot', preview: URL.createObjectURL(file) };
				uploading = [...uploading, pending];
				return upload(file, pending);
			})
		);
	}

	async function remove(item: UploadedItem) {
		items = items.filter((i) => i.id !== item.id);
		emit();
		announcement = `${item.name} removed`;
		if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview);
		await fetch(`/api/uploads/${item.id}`, { method: 'DELETE' }).catch(() => {});
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const files = [...(e.dataTransfer?.files ?? [])];
		if (files.length) void addFiles(files, 'dropped');
	}
</script>

<div class="grid gap-2">
	{#if enhanced}
		{#each items as item (item.id)}
			<input type="hidden" {name} value={item.id} />
		{/each}
		<div
			role="group"
			aria-label={label}
			class={cn(
				'rounded-lg border border-dashed border-border-strong transition-colors',
				dragging && 'border-primary bg-primary-soft',
				compact ? 'p-2' : 'p-3'
			)}
			ondragenter={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondragover={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondragleave={(e) => {
				if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragging = false;
			}}
			ondrop={onDrop}
		>
			{#if items.length || uploading.length}
				<ul class="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5" aria-label="Attached images">
					{#each items as item (item.id)}
						<li class="group relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
							<img src={item.preview} alt={item.name} class="size-full object-cover" />
							<div
								class="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[0.6875rem] text-white"
								title={item.name}
							>
								{item.name}
							</div>
							<button
								type="button"
								class="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-black/70 text-white opacity-90 transition-opacity hover:bg-black focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
								aria-label="Remove {item.name}"
								onclick={() => remove(item)}
							>
								<X class="size-3.5" />
							</button>
						</li>
					{/each}
					{#each uploading as pending (pending.key)}
						<li class="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
							<img src={pending.preview} alt="" class="size-full object-cover opacity-40" />
							<div class="absolute inset-0 flex items-center justify-center">
								<LoaderCircle class="size-5 animate-spin text-foreground" />
								<span class="sr-only">Uploading {pending.name}</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			<div class={cn('flex items-center gap-3', compact ? 'text-xs' : 'text-sm')}>
				<button
					type="button"
					class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-[0.8125rem] font-medium hover:bg-hover"
					onclick={() => fileInput?.click()}
					disabled={items.length + uploading.length >= maxFiles}
				>
					<ImagePlus class="size-4" />
					{compact ? 'Image' : 'Add screenshots'}
				</button>
				<p class="text-muted-foreground">
					{#if compact}
						Drop or paste images
					{:else}
						Drag & drop, or paste with <kbd class="rounded border border-border px-1 text-xs">Ctrl</kbd> +
						<kbd class="rounded border border-border px-1 text-xs">V</kbd>. Up to {maxFiles}, {formatBytes(maxSize)} each.
					{/if}
				</p>
			</div>
			<input
				bind:this={fileInput}
				type="file"
				accept={acceptAttr}
				multiple
				class="sr-only"
				tabindex="-1"
				aria-hidden="true"
				onchange={(e) => {
					const input = e.currentTarget as HTMLInputElement;
					void addFiles([...(input.files ?? [])]);
					input.value = '';
				}}
			/>
		</div>
		{#if errors.length}
			<ul class="grid gap-1" role="alert">
				{#each errors as error, i (i)}
					<li class="flex items-center gap-1.5 text-xs text-destructive">
						<TriangleAlert class="size-3.5 shrink-0" />{error}
					</li>
				{/each}
			</ul>
		{/if}
		<div class="sr-only" aria-live="polite">{announcement}</div>
	{:else}
		<input
			type="file"
			name="files"
			accept={acceptAttr}
			multiple
			aria-label={label}
			class="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-foreground"
		/>
	{/if}
</div>
