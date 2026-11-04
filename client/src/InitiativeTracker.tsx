import { useState } from 'react'
import type { Combat, Placement, Token } from './types'

interface Props {
  combat: Combat | null
  isGm: boolean
  canNext: boolean
  tokens: Map<string, Token>
  placements: Placement[]
  onFocus: (tokenId: string) => void
  onSetInitiative: (tokenId: string, initiative: number) => void
  onRemove: (tokenId: string) => void
  onStart: () => void
  onNext: () => void
  onEnd: () => void
  onResetMovement: () => void
}

const rollD20 = () => Math.floor(Math.random() * 20) + 1

export function InitiativeTracker(props: Props) {
  const { combat, tokens, placements } = props
  const [pick, setPick] = useState('')
  const [value, setValue] = useState('')

  const entries = combat?.entries ?? []
  const inOrder = new Set(entries.map((e) => e.tokenId))
  const addable = placements.filter((p) => !inOrder.has(p.tokenId) && tokens.has(p.tokenId))
  const chosen = addable.some((p) => p.tokenId === pick) ? pick : (addable[0]?.tokenId ?? '')
  const typed = value.trim() === '' ? null : Math.round(Number(value))
  const typedOk = typed === null || (Number.isFinite(typed) && typed >= -100 && typed <= 1000)
  const active = combat?.active ?? false

  return (
    <section className="tracker" aria-label="Initiative">
      <h2>{active ? `Round ${combat?.round}` : 'Initiative'}</h2>
      <div className="tracker-actions">
        {active ? (
          <>
            {props.canNext && <button onClick={props.onNext}>Next turn</button>}
            {props.isGm && (
              <>
                <button onClick={props.onResetMovement} title="Give the current token its full movement back">
                  Reset move
                </button>
                <button className="danger" onClick={props.onEnd}>
                  End
                </button>
              </>
            )}
          </>
        ) : props.isGm ? (
          <button disabled={entries.length === 0} onClick={props.onStart}>
            Start combat
          </button>
        ) : null}
      </div>

      <ol className="tracker-list">
        {entries.map((entry) => {
          const t = tokens.get(entry.tokenId)
          if (!t) return null
          const current = active && combat?.currentTokenId === entry.tokenId
          return (
            <li key={entry.tokenId} className={current ? 'current' : undefined}>
              <span className="turn-marker">{current ? '▶' : ''}</span>
              <button className="link" title="Zoom to token" onClick={() => props.onFocus(entry.tokenId)}>
                {t.imageUrl ? (
                  <img className="swatch" src={t.imageUrl} alt="" style={{ borderColor: t.color }} />
                ) : (
                  <span className="swatch" style={{ background: t.color }} />
                )}
                {t.name}
              </button>
              {props.isGm ? (
                <input
                  key={`i${entry.initiative}`}
                  className="init-input"
                  type="number"
                  aria-label={`${t.name} initiative`}
                  min={-100}
                  max={1000}
                  defaultValue={entry.initiative}
                  onBlur={(e) => {
                    const n = Math.round(Number(e.target.value))
                    if (e.target.value !== '' && Number.isFinite(n) && n !== entry.initiative && n >= -100 && n <= 1000)
                      props.onSetInitiative(entry.tokenId, n)
                    else e.target.value = String(entry.initiative)
                  }}
                />
              ) : (
                <span className="hp">{entry.initiative}</span>
              )}
              <span className="hp">
                {t.hp}/{t.maxHp}
              </span>
              {props.isGm && (
                <button
                  className="danger icon-button"
                  aria-label={`Remove ${t.name} from initiative`}
                  onClick={() => props.onRemove(entry.tokenId)}
                >
                  ✕
                </button>
              )}
              {current && (
                <span className="moved">
                  Moved {combat?.movedFeet}/{t.speedFeet} ft
                </span>
              )}
            </li>
          )
        })}
        {entries.length === 0 && <li className="empty">No one in the order yet.</li>}
      </ol>

      {props.isGm && addable.length > 0 && (
        <div className="tracker-add">
          <select aria-label="Token to add" value={chosen} onChange={(e) => setPick(e.target.value)}>
            {addable.map((p) => (
              <option key={p.tokenId} value={p.tokenId}>
                {tokens.get(p.tokenId)?.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            aria-label="Initiative"
            placeholder="d20"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            disabled={!chosen || !typedOk}
            onClick={() => {
              props.onSetInitiative(chosen, typed ?? rollD20())
              setValue('')
            }}
          >
            Add
          </button>
        </div>
      )}
    </section>
  )
}
