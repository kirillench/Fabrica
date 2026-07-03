import { FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

/**
 * База знаний: загрузка и список документов.
 * wide=true — полноширинная раскладка для отдельной вкладки
 * (просторная зона загрузки, список в две колонки).
 */
export default function Sidebar({ docs, onUpload, onDelete, uploading, wide = false }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = (files) => {
    if (files?.length) onUpload(Array.from(files))
  }

  return (
    <aside className={`glass flex flex-col p-4 ${wide ? '' : 'h-full'}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-base-300">
        База знаний
      </h2>

      <div
        className={`glass-soft glass-hover flex cursor-pointer flex-col items-center gap-2 px-3 text-center transition ${
          wide ? 'py-10' : 'py-6'
        } ${dragOver ? 'border-white/30 bg-white/10' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        {uploading ? (
          <Loader2 size={22} className="spin text-base-300" />
        ) : (
          <Upload size={22} className="text-base-300" />
        )}
        <p className="text-sm text-base-200">
          {uploading ? 'Индексация…' : 'Перетащите файлы или нажмите'}
        </p>
        <p className="text-xs text-base-400">PDF · DOCX · XLSX · TXT · CSV · MD</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,.xlsx,.txt,.csv,.md"
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <div
        className={`mt-4 ${
          wide
            ? 'grid grid-cols-1 gap-2 sm:grid-cols-2'
            : 'flex-1 space-y-2 overflow-y-auto'
        }`}
      >
        {docs.length === 0 && (
          <p className="px-1 text-xs leading-relaxed text-base-400 sm:col-span-2">
            Загрузите статьи, патенты, отчёты об экспериментах — система будет
            искать в них обоснования для гипотез.
          </p>
        )}
        {docs.map((d) => (
          <div
            key={d.id}
            className="glass-soft glass-hover group flex items-center gap-2.5 px-3 py-2.5"
          >
            <FileText size={16} className="shrink-0 text-base-400" />
            <div className="min-w-0 flex-1">
              <a
                href={`/api/documents/${d.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm text-base-100 hover:underline"
                title={d.filename}
              >
                {d.filename}
              </a>
              <p className="text-xs text-base-400">{d.chunks} фрагм.</p>
            </div>
            <button
              className="opacity-0 transition group-hover:opacity-100"
              title="Удалить из базы"
              onClick={() => onDelete(d.id)}
            >
              <Trash2 size={15} className="text-base-400 hover:text-base-200" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
