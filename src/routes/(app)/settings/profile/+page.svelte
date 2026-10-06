<script lang="ts">
	import { enhance } from '$app/forms';
	import Upload from '@lucide/svelte/icons/upload';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Textarea from '$lib/components/ui/textarea.svelte';
	import NativeSelect from '$lib/components/ui/native-select.svelte';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const values = $derived((form?.values ?? data.profile) as Record<string, string>);
	let avatarForm: HTMLFormElement | undefined = $state();
</script>

<Card class="p-5 sm:p-6">
	<h2 class="text-base font-semibold">Avatar</h2>
	<div class="mt-4 flex flex-wrap items-center gap-4">
		<UserAvatar user={data.profile} size="xl" />
		<form
			bind:this={avatarForm}
			method="POST"
			action="?/avatar"
			enctype="multipart/form-data"
			class="flex flex-wrap items-center gap-2"
			use:enhance={quickSubmit({ success: 'Avatar updated' })}
		>
			<input
				type="file"
				name="avatar"
				accept="image/png,image/jpeg,image/webp,image/gif"
				aria-label="Avatar image"
				class="max-w-56 text-sm text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-2.5 file:py-1 file:text-foreground"
				onchange={() => avatarForm?.requestSubmit()}
			/>
			<noscript
				><Button type="submit" size="sm" variant="secondary"><Upload /> Upload</Button></noscript
			>
		</form>
		{#if data.profile.avatarId}
			<form
				method="POST"
				action="?/removeAvatar"
				use:enhance={quickSubmit({ success: 'Avatar removed' })}
			>
				<Button type="submit" variant="ghost" size="sm">Remove</Button>
			</form>
		{/if}
	</div>
	{#if errors.avatar}<p class="mt-2 text-xs text-destructive" role="alert">{errors.avatar}</p>{/if}
</Card>

<Card class="p-5 sm:p-6">
	<h2 class="text-base font-semibold">Profile</h2>
	<form
		method="POST"
		action="?/profile"
		class="mt-4 grid gap-4"
		use:enhance={quickSubmit({ success: 'Profile saved' })}
	>
		<FormMessage message={errors.form} />
		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Display name" for="displayName" error={errors.displayName}
				><Input
					id="displayName"
					name="displayName"
					required
					maxlength={60}
					value={values.displayName}
				/></Field
			>
			<Field
				label="Username"
				for="username"
				error={errors.username}
				hint="Others mention you with @{values.username}"
				><Input
					id="username"
					name="username"
					required
					maxlength={32}
					value={values.username}
					autocapitalize="none"
				/></Field
			>
		</div>
		<Field label="Email" for="email" error={errors.email}
			><Input id="email" name="email" type="email" required value={values.email} /></Field
		>
		<Field label="Bio" for="bio" optional error={errors.bio}
			><Textarea id="bio" name="bio" rows={2} maxlength={280} value={values.bio ?? ''} /></Field
		>
		<div class="flex justify-end"><Button type="submit">Save profile</Button></div>
	</form>
</Card>

<Card class="p-5 sm:p-6">
	<h2 class="text-base font-semibold">Appearance</h2>
	<form
		method="POST"
		action="?/theme"
		class="mt-4 flex flex-wrap items-end gap-2"
		use:enhance={quickSubmit({
			success: 'Theme saved – reloading…',
			onSuccess: () => setTimeout(() => location.reload(), 300)
		})}
	>
		<Field label="Theme" for="theme" class="w-48">
			<NativeSelect id="theme" name="theme" value={data.profile.theme ?? data.theme}>
				<option value="dark">Dark</option>
				<option value="light">Light</option>
				<option value="system">Follow system</option>
			</NativeSelect>
		</Field>
		<Button type="submit" variant="secondary">Save</Button>
	</form>
</Card>
