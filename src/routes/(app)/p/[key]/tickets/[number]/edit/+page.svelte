<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import TicketFields, { type TicketDraft } from '$lib/components/TicketFields.svelte';
	import AttachmentGallery from '$lib/components/AttachmentGallery.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import { TICKET_TYPES, TYPE_META, type TicketType } from '$lib/shared/constants';
	import { ticketPath } from '$lib/shared/format';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let type = $state<TicketType>('bug');
	let draft = $state<TicketDraft>({ title: '', description: '', context: {}, attachments: [] });
	let pending = $state(false);
	let editorKey = $state(0);

	$effect.pre(() => {
		const v = (form?.values ?? null) as Record<string, string> | null;
		type = (v?.type as TicketType) ?? data.ticket.type;
		draft = {
			title: v?.title ?? data.ticket.title,
			description: v?.description ?? data.ticket.descriptionHtml,
			context: v
				? Object.fromEntries(
						Object.entries(v)
							.filter(([k]) => k.startsWith('ctx_'))
							.map(([k, val]) => [k.slice(4), val])
					)
				: { ...(data.ticket.context as Record<string, string>) },
			attachments: []
		};
	});
	const back = $derived(ticketPath(data.project.key, data.ticket.number));
</script>

<div class="mx-auto grid max-w-4xl gap-6">
	<div>
		<a
			href={back}
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" /> Back to {data.ticket.ref}</a
		>
		<h1 class="mt-2 text-xl font-semibold tracking-tight">Edit {data.ticket.ref}</h1>
	</div>
	<Card class="p-5">
		<form
			method="POST"
			enctype="multipart/form-data"
			class="grid gap-5"
			use:enhance={() => {
				pending = true;
				return async ({ result, update }) => {
					pending = false;
					if (result.type === 'redirect') toast.success('Ticket updated');
					await update({ reset: false });
					if (result.type === 'failure') editorKey++;
				};
			}}
		>
			<FormMessage message={errors.form} />
			<Field label="Type" for="type">
				<Select
					id="type"
					name="type"
					bind:value={type}
					items={TICKET_TYPES.map((tt) => ({ value: tt, label: TYPE_META[tt].label }))}
				/>
			</Field>
			<TicketFields
				{type}
				bind:draft
				{errors}
				{editorKey}
				allowAttachments={data.permissions.canAttach && data.remainingAttachments > 0}
				limits={{
					maxFiles: data.remainingAttachments,
					maxSize: data.app.maxAttachmentSize,
					accept: data.app.allowedImageTypes
				}}
			/>
			{#if data.attachments.length}
				<div class="grid gap-2">
					<p class="text-[0.8125rem] font-medium">Current screenshots</p>
					<AttachmentGallery items={data.attachments} size="sm" />
					<p class="text-xs text-muted-foreground">Remove screenshots from the ticket page.</p>
				</div>
			{/if}
			<div class="flex justify-end gap-2 border-t border-border pt-5">
				<Button href={back} variant="ghost">Cancel</Button>
				<Button type="submit" loading={pending}>Save changes</Button>
			</div>
		</form>
	</Card>
</div>
