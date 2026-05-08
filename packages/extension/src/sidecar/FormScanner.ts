/**
 * FormScanner - Automatically scans the current page for all fillable forms
 * and input fields, grouping them by form element with intelligent sorting.
 *
 * Filtering: only text-like inputs (text, email, tel, url, search, number,
 * textarea, select). Excludes: radio, checkbox, range, color, date, etc.
 *
 * Sorting rules:
 * 1. Complete forms (with <form> tag) are listed before orphan inputs
 * 2. Forms with more fields are listed first
 * 3. Forms higher up on the page are listed first (as tiebreaker)
 */

export interface ScannedFormField {
	tagName: string
	type?: string
	name?: string
	id?: string
	placeholder?: string
	label: string
	selector: string
	position: number // scroll Y position for sorting
}

export interface ScannedFormGroup {
	formId: string
	formName?: string
	isFormElement: boolean // true if wrapped in <form> tag
	fields: ScannedFormField[]
	position: number // average position of fields
}

export interface PageFormScanResult {
	url: string
	domain: string
	title: string
	formGroups: ScannedFormGroup[]
	timestamp: number
}

// Allowed input types — only text-like inputs, no UI widgets
const ALLOWED_TYPES = new Set(['text', 'email', 'tel', 'url', 'search', 'number'])
const EXCLUDED_TYPES = new Set([
	'password',
	'hidden',
	'button',
	'submit',
	'reset',
	'image',
	'file',
	'radio',
	'checkbox',
	'range',
	'color',
	'date',
	'datetime-local',
	'month',
	'time',
	'week',
])
const SENSITIVE_LABELS =
	/password|passwd|pwd|pass|cvv|cvc|security.?code|ssn|credit.?card|card.?number|secret|token|key/i

function isAllowedField(el: Element): boolean {
	const tag = el.tagName.toLowerCase()
	if (tag === 'textarea' || tag === 'select') return true

	const input = el as HTMLInputElement
	if (EXCLUDED_TYPES.has(input.type)) return false
	if (ALLOWED_TYPES.has(input.type)) return true
	// Default: skip unknown types to be safe
	return false
}

function isSensitiveField(el: Element): boolean {
	const input = el as HTMLInputElement
	if (EXCLUDED_TYPES.has(input.type)) return true

	const label = getFieldLabel(el).toLowerCase()
	const name = (input.name || '').toLowerCase()
	const placeholder = (input.placeholder || '').toLowerCase()
	const id = (input.id || '').toLowerCase()

	return (
		SENSITIVE_LABELS.test(label) ||
		SENSITIVE_LABELS.test(name) ||
		SENSITIVE_LABELS.test(placeholder) ||
		SENSITIVE_LABELS.test(id)
	)
}

function getFieldLabel(el: Element): string {
	const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

	// aria-labelledby
	const labelledBy = el.getAttribute('aria-labelledby')
	if (labelledBy) {
		const labelEl = document.getElementById(labelledBy)
		if (labelEl) return labelEl.textContent?.trim() ?? ''
	}

	// aria-label
	const ariaLabel = el.getAttribute('aria-label')
	if (ariaLabel) return ariaLabel

	// <label for="id">
	if (el.id) {
		const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
		if (label) return label.textContent?.trim() ?? ''
	}

	// parent <label>
	const parentLabel = el.closest('label')
	if (parentLabel) return parentLabel.textContent?.trim() ?? ''

	// placeholder as fallback
	return input.placeholder || input.name || ''
}

function getElementPosition(el: Element): number {
	const rect = el.getBoundingClientRect()
	return rect.top + window.scrollY
}

function getMinimalSelector(el: Element, depth = 0): string {
	// Prevent stack overflow on extremely deep DOMs
	if (depth > 10) {
		const tag = el.tagName.toLowerCase()
		const nth =
			Array.from(el.parentElement?.children ?? [])
				.filter((c) => c.tagName === el.tagName)
				.indexOf(el) + 1
		return nth > 1 ? `${tag}:nth-of-type(${nth})` : tag
	}

	if (el.id) return `#${CSS.escape(el.id)}`

	const tag = el.tagName.toLowerCase()
	const name = el.getAttribute('name')
	if (name) {
		return `${tag}[name="${CSS.escape(name)}"]`
	}

	const parent = el.parentElement
	if (parent) {
		const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
		const index = siblings.indexOf(el)
		if (siblings.length === 1) {
			return `${getMinimalSelector(parent, depth + 1)} > ${tag}`
		}
		return `${getMinimalSelector(parent, depth + 1)} > ${tag}:nth-of-type(${index + 1})`
	}

	return tag
}

function extractFields(container: Element): ScannedFormField[] {
	const fields: ScannedFormField[] = []

	container.querySelectorAll('input, textarea, select').forEach((el) => {
		if (!isAllowedField(el)) return
		if (isSensitiveField(el)) return

		const input = el as HTMLInputElement
		const label = getFieldLabel(el)
		if (!label && !input.name && !input.id && !input.placeholder) return

		fields.push({
			tagName: el.tagName,
			type: input.type,
			name: input.getAttribute('name') || undefined,
			id: el.id || undefined,
			placeholder: input.placeholder || undefined,
			label,
			selector: getMinimalSelector(el),
			position: getElementPosition(el),
		})
	})

	return fields
}

function getFormName(form: HTMLFormElement): string | undefined {
	const ariaLabel = form.getAttribute('aria-label')
	if (ariaLabel) return ariaLabel

	const heading = form.querySelector('h1, h2, h3, h4, legend')
	if (heading) return heading.textContent?.trim()

	let prev = form.previousElementSibling
	for (let i = 0; i < 3 && prev; i++) {
		if (prev.matches('h1, h2, h3, h4')) {
			return prev.textContent?.trim()
		}
		prev = prev.previousElementSibling
	}

	const firstField = form.querySelector('input, textarea, select')
	if (firstField) {
		const label = getFieldLabel(firstField)
		if (label) return label
	}

	return undefined
}

function extractOrphanFields(): ScannedFormField[] {
	const fields: ScannedFormField[] = []

	document.querySelectorAll('input, textarea, select').forEach((el) => {
		if (el.closest('form')) return
		if (!isAllowedField(el)) return
		if (isSensitiveField(el)) return

		const input = el as HTMLInputElement
		const label = getFieldLabel(el)
		if (!label && !input.name && !input.id && !input.placeholder) return

		fields.push({
			tagName: el.tagName,
			type: input.type,
			name: input.getAttribute('name') || undefined,
			id: el.id || undefined,
			placeholder: input.placeholder || undefined,
			label,
			selector: getMinimalSelector(el),
			position: getElementPosition(el),
		})
	})

	return fields
}

export function scanPageForms(): PageFormScanResult {
	const formGroups: ScannedFormGroup[] = []

	document.querySelectorAll('form').forEach((form, index) => {
		const fields = extractFields(form)
		if (fields.length === 0) return

		const positions = fields.map((f) => f.position)
		formGroups.push({
			formId: `form-${index}`,
			formName: getFormName(form),
			isFormElement: true,
			fields,
			position: positions.reduce((a, b) => a + b, 0) / positions.length,
		})
	})

	const orphanFields = extractOrphanFields()
	if (orphanFields.length > 0) {
		const positions = orphanFields.map((f) => f.position)
		formGroups.push({
			formId: 'orphan',
			formName: 'Input Fields',
			isFormElement: false,
			fields: orphanFields,
			position: positions.reduce((a, b) => a + b, 0) / positions.length,
		})
	}

	formGroups.sort((a, b) => {
		if (a.isFormElement !== b.isFormElement) {
			return a.isFormElement ? -1 : 1
		}
		if (b.fields.length !== a.fields.length) {
			return b.fields.length - a.fields.length
		}
		return a.position - b.position
	})

	return {
		url: window.location.href,
		domain: new URL(window.location.href).hostname,
		title: document.title,
		formGroups,
		timestamp: Date.now(),
	}
}

export function hasFillableForms(): boolean {
	return scanPageForms().formGroups.length > 0
}
