<script lang="ts">
	import { enhance } from '$app/forms';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import NativeSelect from '$lib/components/ui/native-select.svelte';
	import { IMAGE_MIME_TYPES } from '$lib/shared/constants';

	let { data, form } = $props();
	const s = $derived(data.settings);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
</script>

<form
	method="POST"
	class="grid max-w-3xl gap-6"
	use:enhance={quickSubmit({ success: 'Settings saved' })}
>
	<Card class="grid gap-4 p-5 sm:p-6">
		<h2 class="text-base font-semibold">General</h2>
		<Field label="Application name" for="appName" error={errors.appName}
			><Input id="appName" name="appName" required maxlength={60} value={s.appName} /></Field
		>
		<Field
			label="Application URL"
			for="appUrl"
			error={errors.appUrl}
			hint="Public base URL used in invitation and reset links. Defaults to the request origin."
			><Input
				id="appUrl"
				name="appUrl"
				type="url"
				placeholder="https://tikket.example.com"
				value={s.appUrl}
			/></Field
		>
		<Field
			label="Default theme"
			for="defaultTheme"
			hint="Users can override this in their profile."
		>
			<NativeSelect id="defaultTheme" name="defaultTheme" value={s.defaultTheme} class="w-48"
				><option value="dark">Dark</option><option value="light">Light</option><option
					value="system">Follow system</option
				></NativeSelect
			>
		</Field>
	</Card>

	<Card class="grid gap-4 p-5 sm:p-6">
		<h2 class="text-base font-semibold">Accounts</h2>
		<label class="flex items-start gap-3"
			><Switch name="registrationEnabled" checked={s.registrationEnabled} class="mt-0.5" /><span
				><span class="block text-sm font-medium">Public registration</span><span
					class="block text-xs text-muted-foreground"
					>Anyone can create an account. When off, accounts are created by admins or via
					invitations.</span
				></span
			></label
		>
		<label class="flex items-start gap-3"
			><Switch
				name="allowUserProjectCreation"
				checked={s.allowUserProjectCreation}
				class="mt-0.5"
			/><span
				><span class="block text-sm font-medium">Users can create projects</span><span
					class="block text-xs text-muted-foreground"
					>When off, only administrators create projects.</span
				></span
			></label
		>
		<div class="grid gap-4 sm:grid-cols-2">
			<Field
				label="Session lifetime (days)"
				for="sessionLifetimeDays"
				error={errors.sessionLifetimeDays}
				hint="Sessions slide forward while in use."
				><Input
					id="sessionLifetimeDays"
					name="sessionLifetimeDays"
					type="number"
					min={1}
					max={365}
					value={s.sessionLifetimeDays}
				/></Field
			>
			<Field
				label="Invitation lifetime (days)"
				for="invitationLifetimeDays"
				error={errors.invitationLifetimeDays}
				><Input
					id="invitationLifetimeDays"
					name="invitationLifetimeDays"
					type="number"
					min={1}
					max={90}
					value={s.invitationLifetimeDays}
				/></Field
			>
		</div>
	</Card>

	<Card class="grid gap-4 p-5 sm:p-6">
		<h2 class="text-base font-semibold">Attachments</h2>
		<div class="grid gap-4 sm:grid-cols-2">
			<Field
				label="Maximum image size (MB)"
				for="maxAttachmentSizeMb"
				error={errors.maxAttachmentSizeMb}
				hint="Capped at {data.hardUploadLimitMb} MB by MAX_UPLOAD_SIZE."
				><Input
					id="maxAttachmentSizeMb"
					name="maxAttachmentSizeMb"
					type="number"
					min={1}
					max={100}
					value={s.maxAttachmentSizeMb}
				/></Field
			>
			<Field
				label="Images per ticket"
				for="maxAttachmentsPerTicket"
				error={errors.maxAttachmentsPerTicket}
				><Input
					id="maxAttachmentsPerTicket"
					name="maxAttachmentsPerTicket"
					type="number"
					min={1}
					max={50}
					value={s.maxAttachmentsPerTicket}
				/></Field
			>
		</div>
		<fieldset>
			<legend class="mb-2 text-[0.8125rem] font-medium">Allowed formats</legend>
			<div class="flex flex-wrap gap-4">
				{#each IMAGE_MIME_TYPES as t (t)}
					<label class="flex items-center gap-2 text-sm"
						><input
							type="checkbox"
							name="allowedImageTypes"
							value={t}
							checked={s.allowedImageTypes.includes(t)}
							class="size-4 accent-[var(--primary)]"
						/>{t.replace('image/', '').toUpperCase()}</label
					>
				{/each}
			</div>
			{#if errors.allowedImageTypes}<p class="mt-1 text-xs text-destructive">
					Select at least one format.
				</p>{/if}
		</fieldset>
	</Card>
	<div class="flex justify-end"><Button type="submit">Save settings</Button></div>
</form>
