import type { SubmitFunction } from '@sveltejs/kit';
import { toast } from 'svelte-sonner';

/** Standard enhance handler: toast on failure/success, keep form values, refresh data. */
export function quickSubmit(
	opts: { success?: string; onSuccess?: () => void; reset?: boolean } = {}
): SubmitFunction {
	return () =>
		async ({ result, update }) => {
			if (result.type === 'failure') {
				const errors = (result.data?.errors ?? {}) as Record<string, string>;
				toast.error(Object.values(errors)[0] ?? 'That did not work.');
				await update({ reset: false });
				return;
			}
			if (result.type === 'error') {
				toast.error(result.error?.message ?? 'Something went wrong.');
				return;
			}
			if (opts.success) toast.success(opts.success);
			opts.onSuccess?.();
			await update({ reset: opts.reset ?? false });
		};
}
