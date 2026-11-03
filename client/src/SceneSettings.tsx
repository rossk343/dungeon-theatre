import { useState } from 'react'
import { MAX_GRID, MIN_GRID, type GridPreview, type Scene } from './types'

const parse = (s: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(s))
  return s.trim() === '' || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n))
}

interface SettingsProps {
  scene: Scene
  busy: boolean
  onPreview: (p: GridPreview) => void
  onSave: (gridSize: number, offsetX: number, offsetY: number) => void
  onReplaceImage: (file: File) => void
}

// Remounted (via key) whenever the saved scene changes, so inputs always match the server.
export function SceneSettings({ scene, busy, onPreview, onSave, onReplaceImage }: SettingsProps) {
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
      <h2>Grid</h2>
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
    </section>
  )
}

export function NewSceneForm({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (name: string, file: File) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [inputKey, setInputKey] = useState(0)

  return (
    <section className="panel">
      <h2>New scene</h2>
      <input placeholder="Scene name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <input
        key={inputKey}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        disabled={busy || !file || !name.trim()}
        onClick={async () => {
          if (!file) return
          if (await onCreate(name.trim(), file)) {
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
