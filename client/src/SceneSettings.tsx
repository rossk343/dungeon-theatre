import { useState } from 'react'
import { MAX_GRID, MIN_GRID, type Chapter, type GridPreview, type Scene } from './types'

const parse = (s: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(s))
  return s.trim() === '' || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n))
}

interface SettingsProps {
  scene: Scene
  chapters: Chapter[]
  busy: boolean
  onPreview: (p: GridPreview) => void
  onSave: (gridSize: number, offsetX: number, offsetY: number) => void
  onReplaceImage: (file: File) => void
  onRename: (name: string) => void
  onMove: (chapterId: string) => void
  onDelete: () => void
}

// Remounted (via key) whenever the saved scene changes, so inputs always match the server.
export function SceneSettings({
  scene, chapters, busy, onPreview, onSave, onReplaceImage, onRename, onMove, onDelete,
}: SettingsProps) {
  const [name, setName] = useState(scene.name)
  const [size, setSize] = useState(String(scene.gridSize))
  const [ox, setOx] = useState(String(scene.gridOffsetX))
  const [oy, setOy] = useState(String(scene.gridOffsetY))

  const values = () => {
    const gridSize = parse(size, MIN_GRID, MAX_GRID, scene.gridSize)
    return {
      gridSize,
      gridOffsetX: parse(ox, 0, gridSize - 1, 0),
      gridOffsetY: parse(oy, 0, gridSize - 1, 0),
    }
  }

  const change = (next: { size?: string; ox?: string; oy?: string }) => {
    const s = next.size ?? size
    const x = next.ox ?? ox
    const y = next.oy ?? oy
    if (next.size !== undefined) setSize(s)
    if (next.ox !== undefined) setOx(x)
    if (next.oy !== undefined) setOy(y)
    const gridSize = parse(s, MIN_GRID, MAX_GRID, scene.gridSize)
    onPreview({
      sceneId: scene.id,
      gridSize,
      gridOffsetX: parse(x, 0, gridSize - 1, 0),
      gridOffsetY: parse(y, 0, gridSize - 1, 0),
    })
  }

  const dirty =
    size !== String(scene.gridSize) || ox !== String(scene.gridOffsetX) || oy !== String(scene.gridOffsetY)

  return (
    <section className="panel">
      <h2>Scene</h2>
      <div className="row first">
        <input
          className="grow"
          value={name}
          maxLength={100}
          aria-label="Scene name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && name.trim() !== scene.name && onRename(name.trim())}
        />
        <button disabled={!name.trim() || name.trim() === scene.name} onClick={() => onRename(name.trim())}>
          Rename
        </button>
      </div>
      <label>
        Chapter
        <select value={scene.chapterId} onChange={(e) => onMove(e.target.value)}>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <h2 className="sub">Grid</h2>
      <p className="hint">Match the lines to the squares printed on the map. Changes preview live.</p>
      <label>
        Square size (px)
        <input type="number" min={MIN_GRID} max={MAX_GRID} value={size} onChange={(e) => change({ size: e.target.value })} />
      </label>
      <label>
        Offset X
        <input type="number" min={0} max={MAX_GRID} value={ox} onChange={(e) => change({ ox: e.target.value })} />
      </label>
      <label>
        Offset Y
        <input type="number" min={0} max={MAX_GRID} value={oy} onChange={(e) => change({ oy: e.target.value })} />
      </label>
      <div className="row">
        <button
          disabled={!dirty}
          onClick={() => {
            const v = values()
            onSave(v.gridSize, v.gridOffsetX, v.gridOffsetY)
          }}
        >
          Save grid
        </button>
        <label className="file-button">
          {busy ? 'Uploading…' : 'Replace map image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onReplaceImage(file)
            }}
          />
        </label>
      </div>
      <p className="hint">
        {scene.width}×{scene.height}px
      </p>
      <div className="row">
        <button
          className="danger"
          onClick={() => {
            if (window.confirm(`Delete "${scene.name}"? Its map and token positions are removed; tokens are kept.`))
              onDelete()
          }}
        >
          Delete scene
        </button>
      </div>
    </section>
  )
}

export function NewTokenForm({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (
    name: string,
    color: string,
    maxHp: number,
    speedFeet: number,
    isPlayer: boolean,
    file: File | null,
  ) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#8a6d3b')
  const [maxHp, setMaxHp] = useState('10')
  const [speed, setSpeed] = useState('30')
  const [isPlayer, setIsPlayer] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [inputKey, setInputKey] = useState(0)
  const hp = Math.round(Number(maxHp))
  const spd = Math.round(Number(speed))
  const valid =
    name.trim() !== '' && Number.isFinite(hp) && hp >= 1 && hp <= 9999 && Number.isFinite(spd) && spd >= 0 && spd <= 999

  return (
    <section className="panel">
      <h2>New token</h2>
      <div className="token-create-fields">
        <label className="token-create-field token-create-name">
          <span>Name</span>
          <input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="token-create-field">
          <span>Colour</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label className="token-create-field">
          <span>Max HP</span>
          <input
            type="number"
            min={1}
            max={9999}
            value={maxHp}
            onChange={(e) => setMaxHp(e.target.value)}
          />
        </label>
        <label className="token-create-field">
          <span>Speed (ft)</span>
          <input
            type="number"
            title="Speed in feet per turn"
            min={0}
            max={999}
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
          />
        </label>
      </div>
      <label className="token-create-field token-create-type">
        <span>Token type</span>
        <select value={String(isPlayer)} onChange={(e) => setIsPlayer(e.target.value === 'true')}>
          <option value="false">NPC / enemy (GM-controlled)</option>
          <option value="true">Player token</option>
        </select>
      </label>
      <label className="token-create-field token-create-art">
        <span>Art (optional)</span>
        <input
          key={inputKey}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <p className="hint">Art is optional; without it the token is a coloured disc.</p>
      <button
        disabled={busy || !valid}
        onClick={async () => {
          if (await onCreate(name.trim(), color, hp, spd, isPlayer, file)) {
            setName('')
            setFile(null)
            setIsPlayer(false)
            setInputKey((k) => k + 1)
          }
        }}
      >
        {busy ? 'Saving…' : 'Create token'}
      </button>
    </section>
  )
}

export function NewSceneForm({
  busy,
  chapters,
  defaultChapterId,
  onCreate,
}: {
  busy: boolean
  chapters: Chapter[]
  defaultChapterId: string | null
  onCreate: (chapterId: string, name: string, file: File) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [inputKey, setInputKey] = useState(0)
  // Fall back to the current scene's chapter, then the first, if the chosen one no longer exists.
  const chapterId =
    [chosen, defaultChapterId].find((c) => c && chapters.some((x) => x.id === c)) ?? chapters[0]?.id ?? ''

  return (
    <section className="panel">
      <h2>New scene</h2>
      <select value={chapterId} aria-label="Chapter" disabled={chapters.length === 0} onChange={(e) => setChosen(e.target.value)}>
        {chapters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input placeholder="Scene name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <input
        key={inputKey}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {chapters.length === 0 && <p className="hint">Add a chapter first.</p>}
      <button
        disabled={busy || !file || !name.trim() || !chapterId}
        onClick={async () => {
          if (!file) return
          if (await onCreate(chapterId, name.trim(), file)) {
            setName('')
            setFile(null)
            setInputKey((k) => k + 1)
          }
        }}
      >
        {busy ? 'Uploading…' : 'Create scene'}
      </button>
    </section>
  )
}
