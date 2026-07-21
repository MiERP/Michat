import { ReactElement, ReactNode, useEffect, useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../../../shared/types/chat'
import MessageItem from './MessageItem'
import { ScrollArea } from '../../ui/scroll-area'

interface MessageListProps {
  messages: ChatMessage[]
  header?: ReactNode
}

export default function MessageList({ messages, header }: MessageListProps): ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <ScrollArea className="h-full">
        <div className="min-h-full p-4">
          {header}
          <div className="flex min-h-[18rem] flex-col items-center justify-center p-4">
            <div className="flex flex-col items-center gap-4 text-muted-foreground">
              <MessageSquare className="h-16 w-16 opacity-20" />
              <div className="flex flex-col gap-1 text-center">
                <p className="text-lg font-medium">{t('ui:newChat')}</p>
                <p className="text-sm">{t('ui:noMessages')}</p>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="px-4 py-6 pb-32">
        {header}
        <div className="space-y-4">
          {messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </ScrollArea>
  )
}
