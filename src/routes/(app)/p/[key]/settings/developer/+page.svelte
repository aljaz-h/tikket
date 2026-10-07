<script lang="ts">
	import TokenManager from '$lib/components/developer/TokenManager.svelte';

	let { data, form } = $props();
</script>

<TokenManager
	kind="project"
	tokens={data.tokens}
	scopes={data.scopes}
	{form}
	projectKey={data.project.key}
	title="Project API tokens"
	description="For CI pipelines, deploy scripts and bots that work on this project only. A project token acts with the rights of the owner who created it and stops working if they are no longer an owner."
/>
