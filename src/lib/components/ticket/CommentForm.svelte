<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import RichTextEditor from '../RichTextEditor.svelte';
	import AttachmentUploader, { type UploadedItem } from '../AttachmentUploader.svelte';
	import UserAvatar from '../UserAvatar.svelte';
	import Button from '../ui/button.svelte';

	interface Props {
		user: { displayName: string; avatarId: string | null };
		allowAttachments: boolean;
		limits: { maxFiles: number; maxSize: number; accept: string[] };
		draftKey: string;
	}
	let { user, allowAttachments, limits, draftKey }: Props = $props();
	let editorKey = $state(0);
	let initial = $state('');
	let attachments = $state<UploadedItem[]>([]);
	let pending = $state(false);
	let formEl: HTMLFormElement | undefined = $state();
	let hasContent = $state(false);

	$effect(() => {
		try {
			initial = localStorage.getItem(draftKey) ?? '';
			hasContent = !!initial;
			if (initial) editorKey++;
		} catch {
			/* ignore */
		}
	});

	function save(html: string) {
		hasContent = !!html;
		try {
			if (html) localStorage.setItem(draftKey, html);
			else localStorage.removeItem(draftKey);
		} catch {
			/* ignore */
		}
	}
</script>

<form
	bind:this={formEl}
	method="POST"
	action="?/comment"
	enctype="multipart/form-data"
	class="flex gap-3"
	use:enhance={() => {
		pending = true;
		return async ({ result, update }) => {
			pending = false;
			if (result.type === 'failure') {
				const errors = (result.data?.errors ?? {}) as Record<string, string>;
				toast.error(Object.values(errors)[0] ?? 'Could not post the comment.');
				return;
			}
			if (result.type === 'success') {
				save('');
				initial = '';
				attachments = [];
				editorKey++;
				toast.success('Comment posted');
			}
			await update({ reset: false });
		};
	}}
>
	<UserAvatar {user} size="md" class="mt-1 hidden sm:inline-flex" />
	<div class="grid min-w-0 flex-1 gap-2">
		<label for="comment-body" class="sr-only">Write a comment</label>
		{#key editorKey}
			<RichTextEditor
				id="comment-body"
				name="body"
				label="Comment"
				value={initial}
				compact
				minHeight="5rem"
				placeholder="Write a comment… Use @username to mention someone."
				onchange={save}
				onsubmitshortcut={() => formEl?.requestSubmit()}
			/>
		{/key}
		{#if allowAttachments}
			<AttachmentUploader
				bind:items={attachments}
				compact
				label="Comment images"
				maxFiles={limits.maxFiles}
				maxSize={limits.maxSize}
				accept={limits.accept}
				onchange={(items) => (hasContent = hasContent || items.length > 0)}
			/>
		{/if}
		<div class="flex items-center justify-end gap-2">
			<span class="hidden text-xs text-muted-foreground sm:inline">Ctrl + Enter to post</span>
			<Button type="submit" loading={pending}>Comment</Button>
		</div>
	</div>
</form>
