import { ReactElement, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import { Placeholder } from '@tiptap/extensions'
import { ScrollArea } from '../../ui/scroll-area'
import { sanitizePastedHtml } from '../../../lib/sanitizePastedHtml'
import './noteEditor.css'

interface NoteEditorProps {
  content: string
  onChange: (content: string) => void
}

export default function NoteEditor({ content, onChange }: NoteEditorProps): ReactElement {
  const { t } = useTranslation('notebook')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({
        placeholder: t('startEditing', 'Enter note content...')
      })
    ],
    content,
    editorProps: {
      attributes: {
        class: 'tiptap-editor prose prose-sm max-w-none focus:outline-none'
      },
      transformPastedHTML: sanitizePastedHtml
    },
    onUpdate: ({ editor }) => {
      const storage = editor.storage as unknown as { markdown: MarkdownStorage }
      const markdown = storage.markdown.getMarkdown()
      onChange(markdown)
    }
  })

  // Clean up the editor instance
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy()
      }
    }
  }, [editor])

  // Sync external content changes into the editor
  useEffect(() => {
    const storage = editor?.storage as unknown as { markdown: MarkdownStorage } | undefined
    if (editor && content !== storage?.markdown.getMarkdown()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  if (!editor) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Editor content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <EditorContent editor={editor} />
        </div>
      </ScrollArea>
    </div>
  )
}
