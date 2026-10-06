import { safeHttpUrl } from './text';
import type { TemplateAnswer, TemplateFieldKind } from './constants';

export interface TemplateFieldDef {
	key: string;
	kind: TemplateFieldKind;
	label: string;
	help: string | null;
	placeholder: string | null;
	required: boolean;
	options: string[];
}

export const TEMPLATE_LIMITS = { shortText: 300, longText: 5000, fields: 25, options: 30 };

/** Form field name for a template question. */
export const templateFieldName = (key: string) => `tpl_${key}`;

/**
 * Validates submitted answers against the template's fields (server-side source of truth;
 * the browser uses the same function for instant feedback). Returns stored answers including a
 * snapshot of each question's label and kind, or field errors keyed by form field name.
 */
export function validateTemplateAnswers(
	fields: TemplateFieldDef[],
	raw: Record<string, unknown>
): { ok: true; answers: TemplateAnswer[] } | { ok: false; errors: Record<string, string> } {
	const answers: TemplateAnswer[] = [];
	const errors: Record<string, string> = {};
	for (const field of fields) {
		const name = templateFieldName(field.key);
		const value = raw[name];
		if (field.kind === 'checkbox') {
			const checked = value === true || value === 'on' || value === 'true' || value === '1';
			if (field.required && !checked) errors[name] = 'Please confirm this to continue';
			answers.push({ key: field.key, label: field.label, kind: field.kind, value: checked });
			continue;
		}
		const text = typeof value === 'string' ? value.trim() : '';
		if (!text) {
			if (field.required) errors[name] = `${field.label} is required`;
			continue;
		}
		switch (field.kind) {
			case 'short_text':
				if (text.length > TEMPLATE_LIMITS.shortText)
					errors[name] = `Keep it under ${TEMPLATE_LIMITS.shortText} characters`;
				else answers.push({ key: field.key, label: field.label, kind: field.kind, value: text });
				break;
			case 'long_text':
				if (text.length > TEMPLATE_LIMITS.longText)
					errors[name] = `Keep it under ${TEMPLATE_LIMITS.longText} characters`;
				else answers.push({ key: field.key, label: field.label, kind: field.kind, value: text });
				break;
			case 'url': {
				const url = safeHttpUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
				if (!url) errors[name] = 'Enter a valid http(s) URL';
				else answers.push({ key: field.key, label: field.label, kind: field.kind, value: url });
				break;
			}
			case 'select':
				if (!field.options.includes(text)) errors[name] = 'Choose one of the options';
				else answers.push({ key: field.key, label: field.label, kind: field.kind, value: text });
				break;
		}
	}
	return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

/** Generates a stable field key from a label (unique within the template). */
export function slugKey(label: string, taken: Set<string>): string {
	const base =
		label
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 30) || 'field';
	let key = base;
	for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
	taken.add(key);
	return key;
}
