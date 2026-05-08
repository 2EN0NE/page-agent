/**
 * SavedArticlesPanel - List and export saved articles from the sidecar.
 */
import { Download, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import {
	type SavedArticleRecord,
	deleteSavedArticle,
	exportSavedArticlesAsMarkdownBundle,
	listSavedArticles,
} from '@/lib/db'

export function SavedArticlesPanel({ onBack }: { onBack: () => void }) {
	const { t } = useI18n()
	const [articles, setArticles] = useState<SavedArticleRecord[]>([])
	const [loading, setLoading] = useState(true)

	const load = async () => {
		setLoading(true)
		const data = await listSavedArticles({ limit: 50 })
		setArticles(data)
		setLoading(false)
	}

	useEffect(() => {
		load()
	}, [])

	const handleDelete = async (id: string) => {
		await deleteSavedArticle(id)
		setArticles((prev) => prev.filter((a) => a.id !== id))
	}

	const handleExportAll = async () => {
		const bundle = await exportSavedArticlesAsMarkdownBundle()
		for (const [filename, content] of Object.entries(bundle)) {
			downloadFile(content, filename, 'text/markdown')
		}
	}

	const handleExportOne = (article: SavedArticleRecord) => {
		const filename = sanitizeFilename(`${article.title}_${article.id.slice(0, 8)}.md`)
		downloadFile(article.markdown, filename, 'text/markdown')
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			<header className="flex items-center justify-between border-b px-3 py-2">
				<Button variant="ghost" size="sm" onClick={onBack} className="cursor-pointer">
					← {t.common.back}
				</Button>
				<span className="text-sm font-medium">{t.savedArticles.title}</span>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={handleExportAll}
						title={t.savedArticles.exportAll}
						className="cursor-pointer"
					>
						<Download className="size-4" />
					</Button>
				</div>
			</header>

			<div className="flex-1 overflow-y-auto p-3 space-y-2">
				{loading && <p className="text-xs text-muted-foreground">{t.common.loading}</p>}
				{!loading && articles.length === 0 && (
					<p className="text-xs text-muted-foreground text-center py-8">{t.savedArticles.empty}</p>
				)}
				{articles.map((article) => (
					<div key={article.id} className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0">
								<p className="text-xs font-medium truncate" title={article.title}>
									{article.title}
								</p>
								<p className="text-[10px] text-muted-foreground truncate">
									{article.domain} · {article.metadata.wordCount} words · Score{' '}
									{article.metadata.readingScore}
								</p>
							</div>
							<div className="flex items-center gap-1 shrink-0">
								<Button
									variant="ghost"
									size="icon-sm"
									className="size-6 cursor-pointer"
									title={t.savedArticles.download}
									onClick={() => handleExportOne(article)}
								>
									<Download className="size-3" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									className="size-6 cursor-pointer text-destructive hover:text-destructive"
									title={t.common.delete}
									onClick={() => handleDelete(article.id)}
								>
									<Trash2 className="size-3" />
								</Button>
							</div>
						</div>
						<pre className="text-[10px] text-muted-foreground bg-background rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
							{article.markdown.slice(0, 300)}...
						</pre>
					</div>
				))}
			</div>
		</div>
	)
}

function downloadFile(content: string, filename: string, mimeType: string) {
	const blob = new Blob([content], { type: mimeType })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	document.body.appendChild(a)
	a.click()
	document.body.removeChild(a)
	URL.revokeObjectURL(url)
}

function sanitizeFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
}
