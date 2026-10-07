<script lang="ts">
	import TokenManager from '$lib/components/developer/TokenManager.svelte';

	let { data, form } = $props();
</script>

<TokenManager
	kind="personal"
	tokens={data.tokens}
	scopes={data.scopes}
	{form}
	title="Personal access tokens"
	description="Tokens let scripts and tools use the Tikket API as you. A token can never do more than your account can, and only what its scopes allow."
/>
