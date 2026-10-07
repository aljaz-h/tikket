<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ImageUp from '@lucide/svelte/icons/image-up';
	import Globe from '@lucide/svelte/icons/globe';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ProjectIcon from './ProjectIcon.svelte';
	import Button from './ui/button.svelte';
	import Card from './ui/card.svelte';
	import FormMessage from './FormMessage.svelte';
	import { cn } from '$lib/utils';

	interface Props {
		project: {
			name: string;
			icon: string | null;
			color: string;
			logoId: string | null;
			url: string | null;
		};
		canEdit: boolean;
	}
	let { project, canEdit }: Props = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	let localPreview = $state<string | null>(null);
	let fetchedId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let dragging = $state(false);
	let busy = $state<'upload' | 'fetch' | 'apply' | 'remove' | null>(null);
	const ACCEPT = 'image/png,image/jpeg,image/webp';

	function choose(file: File | null | undefined) {
		error = null;
		localPreview = null;
		if (!file) return;
		if (!ACCEPT.split(',').includes(file.type)) {
			error = 'Use a PNG, JPEG or WebP image.';
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			error = 'The logo must be 5 MB or smaller.';
			return;
		}
		// A data: URL keeps the preview within the page's CSP (img-src allows data:).
		const reader = new FileReader();
		reader.onload = () => {
			if (fileInput?.files?.[0] === file) localPreview = String(reader.result);
		};
		reader.readAsDataURL(file);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (!file || !fileInput) return;
		const dt = new DataTransfer();
		dt.items.add(file);
		fileInput.files = dt.files;
		choose(file);
	}

	const submit =
		(
			kind: NonNullable<typeof busy>,
			success?: string,
			after?: (data: Record<string, unknown>) => void
		) =>
		() => {
			busy = kind;
			error = null;
			return async ({
				result,
				update
			}: {
				result: { type: string; data?: Record<string, unknown> };
				update: (o?: { reset?: boolean }) => Promise<void>;
			}) => {
				busy = null;
				if (result.type === 'failure') {
					error = String(
						(result.data?.errors as Record<string, string> | undefined)?.logo ??
							'That did not work.'
					);
					return;
				}
				if (result.type === 'success') {
					after?.(result.data ?? {});
					if (success) toast.success(success);
				}
				await update({ reset: true });
			};
		};
	const previewSrc = $derived(
		localPreview ?? (fetchedId ? `/api/project-logos/${fetchedId}` : null)
	);
</script>

<Card class="p-5 sm:p-6" id="logo">
	<h2 class="text-base font-semibold">Logo</h2>
	<p class="mb-5 text-sm text-muted-foreground">
		Shown wherever the project appears. Without a logo, the emoji or first letter is used.
	</p>
	<div class="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
		<div class="flex items-center gap-4 sm:flex-col">
			<ProjectIcon {project} src={previewSrc} size="xl" />
			{#if previewSrc}<span class="text-xs text-muted-foreground">Preview</span>{/if}
		</div>

		<div class="grid gap-3">
			<FormMessage message={error} />
			{#if canEdit}
				<form
					method="POST"
					action="?/uploadLogo"
					enctype="multipart/form-data"
					class="grid gap-3"
					use:enhance={submit('upload', 'Logo updated', () => choose(null))}
				>
					<label
						class={cn(
							'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground transition-colors hover:border-border-strong',
							dragging && 'border-primary-border bg-primary-soft'
						)}
						ondragover={(e) => {
							e.preventDefault();
							dragging = true;
						}}
						ondragleave={() => (dragging = false)}
						ondrop={onDrop}
					>
						<ImageUp class="size-5" />
						<span
							><span class="font-medium text-foreground">Choose an image</span> or drop it here</span
						>
						<span class="text-xs">PNG, JPEG or WebP, up to 5 MB. Shown as a square.</span>
						<input
							bind:this={fileInput}
							type="file"
							name="logo"
							accept={ACCEPT}
							class="sr-only"
							aria-label="Logo image"
							onchange={(e) => choose((e.currentTarget as HTMLInputElement).files?.[0])}
						/>
					</label>
					<div class="flex flex-wrap gap-2">
						<Button type="submit" disabled={!localPreview} loading={busy === 'upload'}
							>{project.logoId ? 'Replace logo' : 'Upload logo'}</Button
						>
						{#if localPreview}<Button
								variant="ghost"
								onclick={() => {
									choose(null);
									if (fileInput) fileInput.value = '';
								}}>Cancel</Button
							>{/if}
					</div>
				</form>

				<div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
					{#if fetchedId}
						<form
							method="POST"
							action="?/applyLogo"
							use:enhance={submit('apply', 'Website icon applied', () => (fetchedId = null))}
						>
							<input type="hidden" name="logoId" value={fetchedId} />
							<Button type="submit" loading={busy === 'apply'}>Use this icon</Button>
						</form>
						<Button variant="ghost" onclick={() => (fetchedId = null)}>Discard</Button>
					{:else}
						<form
							method="POST"
							action="?/fetchLogo"
							use:enhance={submit(
								'fetch',
								undefined,
								(d) => (fetchedId = String(d.logoPreview ?? '') || null)
							)}
						>
							<Button
								type="submit"
								variant="secondary"
								loading={busy === 'fetch'}
								disabled={!project.url}
								title={project.url ? undefined : 'Add the project website first'}
								><Globe /> Fetch website icon</Button
							>
						</form>
					{/if}
					{#if project.logoId && !fetchedId}
						<form
							method="POST"
							action="?/removeLogo"
							use:enhance={submit('remove', 'Logo removed')}
						>
							<Button type="submit" variant="ghost" loading={busy === 'remove'}
								><Trash2 /> Remove logo</Button
							>
						</form>
					{/if}
				</div>
				{#if project.url && !fetchedId}
					<p class="text-xs text-muted-foreground">
						Looks for the icon of {new URL(project.url).host} and shows a preview first.
					</p>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">Unarchive the project to change its logo.</p>
			{/if}
		</div>
	</div>
</Card>
