<script lang="ts">
	import Field from './ui/field.svelte';
	import Input from './ui/input.svelte';

	interface Props {
		errors?: Record<string, string>;
		values?: Record<string, string>;
		lockedEmail?: string | null;
	}
	let { errors = {}, values = {}, lockedEmail = null }: Props = $props();
</script>

<Field label="Display name" for="displayName" error={errors.displayName}>
	<Input
		id="displayName"
		name="displayName"
		autocomplete="name"
		required
		maxlength={60}
		value={values.displayName ?? ''}
		aria-invalid={!!errors.displayName}
	/>
</Field>
<Field label="Username" for="username" error={errors.username} hint="Used for @mentions.">
	<Input
		id="username"
		name="username"
		autocomplete="username"
		required
		minlength={2}
		maxlength={32}
		value={values.username ?? ''}
		aria-invalid={!!errors.username}
		autocapitalize="none"
		spellcheck="false"
	/>
</Field>
<Field label="Email" for="email" error={errors.email}>
	<Input
		id="email"
		name="email"
		type="email"
		autocomplete="email"
		required
		value={lockedEmail ?? values.email ?? ''}
		readonly={!!lockedEmail}
		aria-invalid={!!errors.email}
	/>
</Field>
<Field label="Password" for="password" error={errors.password} hint="At least 10 characters.">
	<Input
		id="password"
		name="password"
		type="password"
		autocomplete="new-password"
		required
		minlength={10}
		aria-invalid={!!errors.password}
	/>
</Field>
<Field label="Confirm password" for="confirmPassword" error={errors.confirmPassword}>
	<Input
		id="confirmPassword"
		name="confirmPassword"
		type="password"
		autocomplete="new-password"
		required
		minlength={10}
		aria-invalid={!!errors.confirmPassword}
	/>
</Field>
