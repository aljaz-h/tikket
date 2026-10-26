import { cubicOut } from 'svelte/easing';
import { crossfade, fade } from 'svelte/transition';

/**
 * Shared motion settings. Everything is short (a fifth of a second or less) and switches off
 * for people who ask their system for reduced motion.
 */
export const reducedMotion = () =>
	typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `ms`, or 0 when the person prefers reduced motion. */
export const ms = (value: number) => (reducedMotion() ? 0 : value);

/** Cards that leave one list and appear in another glide across instead of jumping. */
export const [send, receive] = crossfade({
	duration: () => ms(220),
	easing: cubicOut,
	fallback: (node) => fade(node, { duration: ms(150) })
});
