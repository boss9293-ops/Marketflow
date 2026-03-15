'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Props = {
  content: string
  className?: string
}

export default function MarkdownRenderer({ content, className }: Props) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-xl font-semibold text-slate-100 mb-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[18px] font-semibold text-slate-100 mt-4 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[16px] font-semibold text-slate-100 mt-3 mb-2">{children}</h3>,
          p: ({ children }) => <p className="text-[15px] text-slate-200 leading-[1.8] mb-3">{children}</p>,
          ul: ({ children }) => <ul className="list-disc ml-5 space-y-2 text-[15px] text-slate-200">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-5 space-y-2 text-[15px] text-slate-200">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="text-slate-100 font-semibold">{children}</strong>,
          hr: () => <hr className="my-4 border-white/10" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
