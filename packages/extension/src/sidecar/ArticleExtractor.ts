/**
 * ArticleExtractor - Extract article content from a webpage and convert to
 * Obsidian-compatible Markdown with YAML frontmatter.
 *
 * Inspired by Obsidian Clipper's defuddle approach:
 * - Density-based content detection (Readability-style heuristics)
 * - Aggressive cleanup of non-content elements
 * - Link/image URL resolution
 * - Clean HTML-to-Markdown conversion
 */

export interface ArticleExtraction {
	markdown: string
	images: { src: string; alt?: string; caption?: string }[]
	tables: { html: string; markdown: string }[]
	metadata: {
		title: string
		url: string
		author?: string
		date?: string
		description?: string
		wordCount: number
	}
}

// ========================================================================
// Public API
// ========================================================================

/**
 * Extract article from the current document.
 */
export function extractArticle(doc: Document): ArticleExtraction {
	const url = doc.location?.href ?? ''
	const title = doc.title ?? ''

	// Clone the document to avoid mutating the live DOM
	const clone = doc.cloneNode(true) as Document

	// Pre-clean: remove scripts, styles, and other non-content elements
	preClean(clone)

	// Resolve all relative URLs to absolute
	resolveUrls(clone, url)

	// Find the main content element
	const contentEl = findMainContent(clone)

	// Extract metadata from the original document (before we mutate clone further)
	const author = getMeta(doc, 'author', 'article:author', 'og:article:author')
	const date = getMeta(doc, 'article:published_time', 'datePublished', 'publish_date', 'date')
	const description = getMeta(doc, 'description', 'og:description')

	// Extract images from content area
	const images = extractImages(contentEl ?? clone.body, url)

	// Extract tables
	const tables = extractTables(contentEl ?? clone.body)

	// Convert content to Markdown
	const markdownBody = htmlToMarkdown(contentEl ?? clone.body, { url })

	const wordCount = countWords(markdownBody)

	// Build Obsidian-compatible frontmatter
	const frontmatter = buildFrontmatter({
		title,
		url,
		author,
		date,
		description,
		wordCount,
		savedAt: new Date().toISOString(),
		via: 'PageAgent Sidecar',
	})

	const markdown = `${frontmatter}\n\n${markdownBody}`

	return {
		markdown,
		images,
		tables,
		metadata: { title, url, author, date, description, wordCount },
	}
}

// ========================================================================
// Pre-clean: Remove non-content elements
// ========================================================================

function preClean(doc: Document) {
	const selectors = [
		'script',
		'style',
		'noscript',
		'nav',
		'header',
		'footer',
		'aside',
		'[role="banner"]',
		'[role="navigation"]',
		'[role="complementary"]',
		'.advertisement',
		'.ad',
		'.ads',
		'.social-share',
		'.comments',
		'.comment-section',
		'.related-articles',
		'.recommended',
		'.sidebar',
		'.popup',
		'.modal',
		'.overlay',
		'.newsletter-signup',
		'.cookie-banner',
		'.gdpr',
		'.consent',
		'.share-buttons',
		'.pagination',
	]

	for (const sel of selectors) {
		for (const el of doc.querySelectorAll(sel)) {
			el.remove()
		}
	}

	// Remove invisible elements (using class/attribute heuristics instead of
	// getComputedStyle to avoid forcing full style recalculation)
	for (const el of doc.querySelectorAll('*')) {
		if (el instanceof HTMLElement) {
			// Remove elements explicitly marked as hidden
			if (el.hidden || el.getAttribute('aria-hidden') === 'true') {
				el.remove()
				continue
			}
			// Remove common overlay/modal patterns
			if (
				el.classList.contains('modal') ||
				el.classList.contains('overlay') ||
				el.classList.contains('popup') ||
				el.classList.contains('hidden') ||
				el.classList.contains('invisible') ||
				el.style.display === 'none' ||
				el.style.visibility === 'hidden'
			) {
				el.remove()
			}
		}
	}
}

// ========================================================================
// URL Resolution
// ========================================================================

function resolveUrls(doc: Document, baseUrl: string) {
	const attrs = ['src', 'href', 'srcset', 'data-src', 'poster']
	for (const el of doc.querySelectorAll('*')) {
		for (const attr of attrs) {
			const val = el.getAttribute(attr)
			if (!val) continue
			if (attr === 'srcset') {
				const resolved = val
					.split(',')
					.map((part) => {
						const [u, size] = part.trim().split(/\s+/)
						try {
							return `${new URL(u, baseUrl).href}${size ? ' ' + size : ''}`
						} catch {
							return part
						}
					})
					.join(', ')
				el.setAttribute(attr, resolved)
			} else if (!val.startsWith('data:') && !val.startsWith('#')) {
				try {
					el.setAttribute(attr, new URL(val, baseUrl).href)
				} catch {
					/* keep original */
				}
			}
		}
	}
}

// ========================================================================
// Content Detection (defuddle-inspired density scoring)
// ========================================================================

function findMainContent(doc: Document): HTMLElement | null {
	// Strategy 1: Semantic HTML5 tags
	const semanticSelectors = ['article', '[role="main"]', 'main']
	for (const sel of semanticSelectors) {
		const el = doc.querySelector(sel)
		if (el && isGoodContent(el as HTMLElement)) {
			return el as HTMLElement
		}
	}

	// Strategy 2: Common content class names
	const classSelectors = [
		'.post-content',
		'.entry-content',
		'.article-content',
		'.content-body',
		'.article-body',
		'.post-body',
		'.story-body',
		'.markdown-body',
		'.prose',
		'.entry',
		'.post',
		'.article',
	]
	for (const sel of classSelectors) {
		const el = doc.querySelector(sel)
		if (el && isGoodContent(el as HTMLElement)) {
			return el as HTMLElement
		}
	}

	// Strategy 3: Density-based scoring (Readability-style)
	return findByDensityScore(doc.body)
}

function isGoodContent(el: HTMLElement): boolean {
	const text = el.textContent ?? ''
	const wordCount = countWords(text)
	return wordCount >= 100
}

interface ScoredElement {
	el: HTMLElement
	score: number
}

function findByDensityScore(root: HTMLElement): HTMLElement | null {
	const candidates: ScoredElement[] = []

	// Walk all block-level containers
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
	let node: Element | null

	while ((node = walker.nextNode() as Element)) {
		if (!(node instanceof HTMLElement)) continue

		const tag = node.tagName.toLowerCase()

		// Skip non-content tags
		if (
			['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'a'].includes(tag)
		) {
			continue
		}

		// Only consider containers that could hold article content
		if (!isContainerTag(tag)) continue

		const text = node.textContent ?? ''
		const words = countWords(text)
		if (words < 50) continue // Too small

		const paragraphs = node.querySelectorAll('p').length
		const headings = node.querySelectorAll('h1, h2, h3, h4, h5, h6').length
		const links = node.querySelectorAll('a').length
		const listItems = node.querySelectorAll('li').length
		const images = node.querySelectorAll('img').length
		const textLength = text.trim().length

		// Density score formula (Readability-inspired)
		// High paragraph density = good content
		// High link density = bad (nav, sidebar)
		const linkDensity = textLength > 0 ? (links * 20) / textLength : 0
		const paragraphDensity = words > 0 ? paragraphs / words : 0

		let score = words
		score += paragraphs * 30
		score += headings * 20
		score += listItems * 5
		score += images * 3

		// Penalize high link density
		if (linkDensity > 0.3) score *= 0.5
		if (linkDensity > 0.5) score *= 0.3

		// Penalize if very few paragraphs relative to words (wall of text without structure)
		if (paragraphs < 3 && words > 300) score *= 0.7

		candidates.push({ el: node, score })
	}

	if (candidates.length === 0) return null

	// Sort by score descending
	candidates.sort((a, b) => b.score - a.score)

	// Return the highest-scoring candidate, but prefer the parent if it has similar score
	// (avoids returning too deeply nested elements)
	const best = candidates[0]
	for (let i = 1; i < candidates.length; i++) {
		const candidate = candidates[i]
		if (candidate.el.contains(best.el) && candidate.score >= best.score * 0.85) {
			return candidate.el
		}
	}

	return best.el
}

function isContainerTag(tag: string): boolean {
	return ['div', 'section', 'article', 'main', 'td', 'li'].includes(tag)
}

// ========================================================================
// Metadata Extraction
// ========================================================================

function getMeta(doc: Document, ...names: string[]): string | undefined {
	for (const name of names) {
		const el = doc.querySelector(`meta[name="${CSS.escape(name)}"]`)
		if (el) return (el as HTMLMetaElement).content || undefined
		const og = doc.querySelector(`meta[property="${CSS.escape(name)}"]`)
		if (og) return (og as HTMLMetaElement).content || undefined
	}
	return undefined
}

// ========================================================================
// Image Extraction
// ========================================================================

function extractImages(container: HTMLElement, baseUrl: string): ArticleExtraction['images'] {
	const imgs = container.querySelectorAll('img')
	const results: ArticleExtraction['images'] = []
	const seen = new Set<string>()

	for (const img of imgs) {
		const src = img.getAttribute('src') || img.getAttribute('data-src') || ''
		if (!src || src.startsWith('data:') || seen.has(src)) continue
		seen.add(src)

		const alt = img.getAttribute('alt') || undefined
		let caption: string | undefined

		// Look for figcaption in parent figure
		const figure = img.closest('figure')
		if (figure) {
			const figcaption = figure.querySelector('figcaption')
			if (figcaption) caption = figcaption.textContent?.trim() || undefined
		}

		results.push({ src, alt, caption })
	}

	return results
}

// ========================================================================
// Table Extraction
// ========================================================================

function extractTables(container: HTMLElement): ArticleExtraction['tables'] {
	const tables = container.querySelectorAll('table')
	const results: ArticleExtraction['tables'] = []

	for (const table of tables) {
		const rows = table.querySelectorAll('tr')
		if (rows.length < 2) continue

		const html = table.outerHTML
		const md = tableToMarkdown(table as HTMLTableElement)
		if (md) results.push({ html, markdown: md })
	}

	return results
}

function tableToMarkdown(table: HTMLTableElement): string {
	const rows: string[][] = []
	let maxCols = 0

	for (const tr of table.querySelectorAll('tr')) {
		const cells: string[] = []
		for (const cell of tr.querySelectorAll('td, th')) {
			const text = (cell.textContent ?? '').trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')
			cells.push(text)
		}
		if (cells.length > 0) {
			rows.push(cells)
			maxCols = Math.max(maxCols, cells.length)
		}
	}

	if (rows.length === 0) return ''

	for (const row of rows) {
		while (row.length < maxCols) row.push('')
	}

	const lines = rows.map((row) => '| ' + row.join(' | ') + ' |')
	if (lines.length > 1) {
		const sep = '| ' + Array(maxCols).fill('---').join(' | ') + ' |'
		lines.splice(1, 0, sep)
	}

	return lines.join('\n')
}

// ========================================================================
// HTML to Markdown
// ========================================================================

interface HtmlToMdOptions {
	url: string
}

function htmlToMarkdown(root: HTMLElement, options: HtmlToMdOptions): string {
	// Deep clone to avoid mutating
	const clone = root.cloneNode(true) as HTMLElement

	// Remove remaining non-content elements within the content area
	for (const sel of ['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript', 'form']) {
		for (const el of clone.querySelectorAll(sel)) {
			el.remove()
		}
	}

	const lines: string[] = []
	walkNodes(clone, lines, options)
	return collapseWhitespace(lines.join('\n\n'))
}

function walkNodes(node: Node, lines: string[], options: HtmlToMdOptions) {
	if (node instanceof Text) {
		const text = node.textContent ?? ''
		if (text.trim()) {
			lines.push(escapeMarkdown(text))
		}
		return
	}

	if (!(node instanceof HTMLElement)) return

	const tag = node.tagName.toLowerCase()

	// Skip empty decorative elements
	if (['br', 'hr', 'wbr'].includes(tag)) {
		if (tag === 'hr') lines.push('---')
		return
	}

	// Skip if no meaningful text
	const textContent = node.textContent?.trim() ?? ''
	if (!textContent && tag !== 'img' && tag !== 'table' && tag !== 'pre') return

	switch (tag) {
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6': {
			const level = parseInt(tag[1])
			const prefix = '#'.repeat(Math.min(level, 6))
			lines.push(`${prefix} ${cleanText(node.textContent ?? '')}`)
			break
		}
		case 'p': {
			const text = inlineMarkdown(node)
			if (text.trim()) lines.push(text)
			break
		}
		case 'blockquote': {
			// Process children first, then quote each line
			const childLines: string[] = []
			for (const child of node.childNodes) {
				walkNodes(child, childLines, options)
			}
			const joined = childLines.join('\n\n')
			if (joined.trim()) {
				lines.push(
					joined
						.split('\n')
						.map((l) => `> ${l}`)
						.join('\n')
				)
			}
			break
		}
		case 'ul':
		case 'ol': {
			const listLines = listToMarkdown(node as HTMLUListElement | HTMLOListElement, 0)
			if (listLines.length) lines.push(...listLines)
			break
		}
		case 'pre': {
			const code = node.querySelector('code')
			const lang = extractLanguage(code) ?? ''
			const text = code?.textContent ?? node.textContent ?? ''
			lines.push(`\`\`\`${lang}\n${text.trim()}\n\`\`\``)
			break
		}
		case 'code': {
			// Inline code handled by inlineMarkdown
			break
		}
		case 'img': {
			const src = node.getAttribute('src') || ''
			const alt = node.getAttribute('alt') || 'image'
			if (src) lines.push(`![${alt}](${src})`)
			break
		}
		case 'table': {
			const md = tableToMarkdown(node as HTMLTableElement)
			if (md) lines.push(md)
			break
		}
		case 'figure': {
			// Handle figure with img and figcaption
			const img = node.querySelector('img')
			const figcaption = node.querySelector('figcaption')
			if (img) {
				const src = img.getAttribute('src') || ''
				const alt = img.getAttribute('alt') || figcaption?.textContent?.trim() || 'image'
				if (src) lines.push(`![${alt}](${src})`)
			}
			if (figcaption && figcaption.textContent?.trim()) {
				lines.push(`*${figcaption.textContent.trim()}*`)
			}
			break
		}
		case 'div':
		case 'section':
		case 'article':
		case 'main':
		case 'span':
		case 'header': // might appear inside article
		case 'footer':
		case 'aside': {
			// Container elements — recurse
			for (const child of node.childNodes) {
				walkNodes(child, lines, options)
			}
			break
		}
		case 'a': {
			const href = node.getAttribute('href') || ''
			const text = cleanText(node.textContent ?? '')
			if (href && text) {
				lines.push(`[${text}](${href})`)
			} else if (text) {
				lines.push(text)
			}
			break
		}
		case 'strong':
		case 'b': {
			const text = cleanText(node.textContent ?? '')
			if (text) lines.push(`**${text}**`)
			break
		}
		case 'em':
		case 'i': {
			const text = cleanText(node.textContent ?? '')
			if (text) lines.push(`*${text}*`)
			break
		}
		default: {
			// For unknown elements, just emit their text content
			const text = cleanText(node.textContent ?? '')
			if (text) lines.push(text)
		}
	}
}

/* eslint-disable @typescript-eslint/prefer-regexp-exec, no-useless-escape */
function inlineMarkdown(el: HTMLElement): string {
	let text = el.innerHTML

	// Convert inline elements
	text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
	text = text.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
	text = text.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
	text = text.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
	text = text.replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
	text = text.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
	text = text.replace(/<img\b[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
	text = text.replace(/<img\b[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)')
	text = text.replace(/<img\b[^>]*src="([^"]*)"[^>]*\/?>/gi, '![image]($1)')
	text = text.replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, '^$1^')
	text = text.replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, '~$1~')
	text = text.replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==')
	text = text.replace(/<del\b[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~')
	text = text.replace(/<s\b[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~')

	// Strip remaining tags
	text = text.replace(/<[^>]+>/g, ' ')
	return collapseInlineWhitespace(text)
}
/* eslint-enable @typescript-eslint/prefer-regexp-exec, no-useless-escape */

function listToMarkdown(list: HTMLUListElement | HTMLOListElement, depth: number): string[] {
	const isOrdered = list.tagName.toLowerCase() === 'ol'
	const start = parseInt(list.getAttribute('start') || '1')
	const lines: string[] = []
	let index = start

	for (const li of list.querySelectorAll(':scope > li')) {
		const indent = '  '.repeat(depth)
		const marker = isOrdered ? `${index++}.` : '-'

		// Extract text, handling inline elements
		const clone = li.cloneNode(true) as HTMLElement
		// Remove nested lists from clone for text extraction
		for (const nested of clone.querySelectorAll(':scope > ul, :scope > ol')) {
			nested.remove()
		}
		const text = inlineMarkdown(clone)
		lines.push(`${indent}${marker} ${text}`)

		// Process nested lists
		for (const nested of li.querySelectorAll(':scope > ul, :scope > ol')) {
			lines.push(...listToMarkdown(nested as HTMLUListElement | HTMLOListElement, depth + 1))
		}
	}

	return lines
}

function extractLanguage(codeEl: Element | null): string | undefined {
	if (!codeEl) return undefined
	const cls = codeEl.getAttribute('class') || ''
	const match = /language-(\w+)/.exec(cls)
	if (match) return match[1]
	const match2 = /lang-(\w+)/.exec(cls)
	if (match2) return match2[1]
	return undefined
}

function escapeMarkdown(text: string): string {
	return text
		.replace(/\\/g, '\\\\')
		.replace(/\*/g, '\\*')
		.replace(/_/g, '\\_')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]')
		.replace(/`/g, '\\`')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

function cleanText(text: string | null): string {
	if (!text) return ''
	return text.replace(/\s+/g, ' ').trim()
}

function collapseWhitespace(text: string): string {
	return text.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '')
}

function collapseInlineWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function countWords(text: string): number {
	return text
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 0).length
}

// ========================================================================
// Frontmatter
// ========================================================================

function buildFrontmatter(meta: Record<string, string | number | undefined>): string {
	const entries = Object.entries(meta).filter(([, v]) => v !== undefined && v !== '')
	const lines = entries.map(([k, v]) => {
		const val =
			typeof v === 'string' && v.includes('\n')
				? `\n  - ${v.split('\n').join('\n  - ')}`
				: String(v)
		return `${k}: ${val}`
	})
	return `---\n${lines.join('\n')}\n---`
}
