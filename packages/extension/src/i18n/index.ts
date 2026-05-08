import { useEffect, useState } from 'react'

import { type Translation, en } from './en'
import { zh } from './zh'

const translations: Record<string, Translation> = { en, zh }

function getBrowserLang(): string {
	const nav = navigator.language || 'zh-CN'
	return nav.startsWith('zh') ? 'zh' : 'en'
}

function getTranslation(lang: string | undefined): Translation {
	if (!lang) return zh
	return translations[lang.startsWith('zh') ? 'zh' : 'en'] ?? zh
}

/**
 * React hook for i18n. Reads language from chrome.storage and falls back
 * to browser locale. Auto-refreshes when language changes in storage.
 */
export function useI18n() {
	const [lang, setLang] = useState<string>('zh')
	const [t, setT] = useState<Translation>(zh)

	useEffect(() => {
		// Initial read
		chrome.storage.local.get('language').then((result) => {
			const stored = result.language as string | undefined
			const detected = stored || getBrowserLang()
			setLang(detected)
			setT(getTranslation(detected))
		})

		// Listen for changes
		const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
			if (changes.language) {
				const newLang = changes.language.newValue as string | undefined
				setLang(newLang || 'zh')
				setT(getTranslation(newLang))
			}
		}
		chrome.storage.onChanged.addListener(handler)
		return () => chrome.storage.onChanged.removeListener(handler)
	}, [])

	return { lang, t }
}

export { en, zh }
export type { Translation }
