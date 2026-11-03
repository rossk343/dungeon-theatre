import { useState } from 'react'
import type { Chapter, Scene } from './types'

interface ChapterTreeProps {
  chapters: Chapter[]
  scenes: Scene[]
  sceneId: string | null
  onSelect: (sceneId: string) => void
  onAdd: (name: string) => Promise<boolean>
  onRename: (chapterId: string, name: string) => void
  onDelete: (chapterId: string) => void
}

function ChapterHeading({ chapter, empty, onRename, onDelete }: {
  chapter: Chapter
  empty: boolean
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(chapter.name)

  const commit = () => {
    const next = name.trim()
    setEditing(false)
    if (next && next !== chapter.name) onRename(next)
    else setName(chapter.name)
  }

  if (editing)
    return (
      <div className="row first">
        <input
          className="grow"
          autoFocus
          value={name}
          maxLength={100}
          aria-label="Chapter name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setName(chapter.name)
              setEditing(false)
            }
          }}
        />
      </div>
    )

  return (
    <div className="chapter-heading">
      <h3>{chapter.name}</h3>
      <button className="icon-button" title="Rename chapter" aria-label={`Rename ${chapter.name}`} onClick={() => setEditing(true)}>
        ✎
      </button>
      <button
        className="icon-button"
        title={empty ? 'Delete chapter' : 'Move or delete its scenes first'}
        aria-label={`Delete ${chapter.name}`}
        disabled={!empty}
        onClick={() => {
          if (window.confirm(`Delete the empty chapter "${chapter.name}"?`)) onDelete()
        }}
      >
        ✕
      </button>
    </div>
  )
}

export function ChapterTree({ chapters, scenes, sceneId, onSelect, onAdd, onRename, onDelete }: ChapterTreeProps) {
  const [newName, setNewName] = useState('')

  const add = async () => {
    if (newName.trim() && (await onAdd(newName.trim()))) setNewName('')
  }

  return (
    <section className="panel">
      <h2>Chapters</h2>
      {chapters.map((c) => {
        const inChapter = scenes.filter((s) => s.chapterId === c.id)
        return (
          <div key={c.id} className="chapter">
            <ChapterHeading
              key={c.name}
              chapter={c}
              empty={inChapter.length === 0}
              onRename={(name) => onRename(c.id, name)}
              onDelete={() => onDelete(c.id)}
            />
            <ul className="scene-list">
              {inChapter.map((s) => (
                <li key={s.id}>
                  <button className={s.id === sceneId ? 'active' : ''} onClick={() => onSelect(s.id)}>
                    {s.name}
                  </button>
                </li>
              ))}
              {inChapter.length === 0 && <li className="hint">No scenes yet</li>}
            </ul>
          </div>
        )
      })}
      <div className="row">
        <input
          className="grow"
          placeholder="New chapter"
          maxLength={100}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button disabled={!newName.trim()} onClick={() => void add()}>
          Add
        </button>
      </div>
    </section>
  )
}
