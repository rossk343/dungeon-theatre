import { useState } from 'react'
import type { Combat, DiceRoll, Placement, Token } from './types'
import { getHealthCondition } from './tokenHealth'

interface Props {
  combat: Combat | null
  isGm: boolean
  canNext: boolean
  tokens: Map<string, Token>
  placements: Placement[]
  onFocus: (tokenId: string) => void
  onSetInitiative: (tokenId: string, initiative: number) => void
  onSetHealth: (token: Token, hp: number) => void
  onRemove: (tokenId: string) => void
  onStart: () => void
  onNext: () => void
  onEnd: () => void
  onResetMovement: () => void
  lastDiceRoll: DiceRoll | null
  onRollDice: (sides: number, count: number, modifier: number) => void
}

const rollD20 = () => Math.floor(Math.random() * 20) + 1

export function InitiativeTracker(props: Props) {
  const { combat, tokens, placements } = props
  const [pick, setPick] = useState('')
  const [value, setValue] = useState('')
  const [diceSides, setDiceSides] = useState(20)
  const [diceCount, setDiceCount] = useState(1)
  const [diceModifier, setDiceModifier] = useState(0)

  const entries = combat?.entries ?? []
  const inOrder = new Set(entries.map((e) => e.tokenId))
  const addable = placements.filter((p) => !inOrder.has(p.tokenId) && tokens.has(p.tokenId))
  const chosen = addable.some((p) => p.tokenId === pick) ? pick : (addable[0]?.tokenId ?? '')
  const typed = value.trim() === '' ? null : Math.round(Number(value))
  const typedOk = typed === null || (Number.isFinite(typed) && typed >= -100 && typed <= 1000)
  const active = combat?.active ?? false

  return (
    <div className="initiative-column">
    <section className="tracker" aria-label="Initiative">
      <h2>{active ? `Round ${combat?.round}` : 'Initiative'}</h2>
      <div className="tracker-actions">
        {active ? (
          <>
            {props.canNext && <button onClick={props.onNext}>Next turn</button>}
            {props.canNext && (
              <button onClick={props.onResetMovement} title="Return the current token to the start of its turn and reset movement">
                Reset move
              </button>
            )}
            {props.isGm && (
              <>
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

      <div className={`tracker-column-headings${props.isGm ? ' gm' : ''}`} aria-hidden="true">
        <span className="tracker-column-name">Name</span>
        <span className="tracker-column-initiative">Initiative</span>
        <span className="tracker-column-health">HP</span>
      </div>
      <ol className={`tracker-list${props.isGm ? ' gm' : ''}`}>
        {entries.map((entry) => {
          const t = tokens.get(entry.tokenId)
          if (!t) return null
          const current = active && combat?.currentTokenId === entry.tokenId
          const healthCondition = getHealthCondition(t.hp, t.maxHp)
          return (
            <li key={entry.tokenId} className={current ? 'current' : undefined}>
              <span className="turn-marker">{current ? '▶' : ''}</span>
              <button className="link" title="Zoom to token" onClick={() => props.onFocus(entry.tokenId)}>
                {t.imageUrl ? (
                  <img className="swatch" src={t.imageUrl} alt="" style={{ borderColor: t.color }} />
                ) : (
                  <span className="swatch" style={{ background: t.color }} />
                )}
                <span className="tracker-token-name">{t.name}</span>
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
              {props.isGm || t.isPlayer ? (
                <input
                  key={`h${t.hp}`}
                  className="tracker-health-input"
                  type="number"
                  aria-label={`${t.name} HP`}
                  min={0}
                  max={t.maxHp}
                  defaultValue={t.hp}
                  onBlur={(e) => {
                    const value = e.target.value
                    const hp = Math.round(Number(value))
                    if (value !== '' && Number.isFinite(hp) && hp >= 0 && hp <= t.maxHp && hp !== t.hp)
                      props.onSetHealth(t, hp)
                    else e.target.value = String(t.hp)
                  }}
                />
              ) : (
                <span
                  className={`npc-health tracker-health ${healthCondition}`}
                  aria-label={`${t.name} health: ${healthCondition}`}
                  role="img"
                />
              )}
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
    <section className="tracker-actions-panel" aria-label="Actions">
        <h3>Actions</h3>
        <label>
          Dice
          <select
            aria-label="Dice sides"
            value={diceSides}
            onChange={(e) => setDiceSides(Number(e.target.value))}
          >
            {[4, 6, 8, 10, 12, 20, 100].map((sides) => (
              <option key={sides} value={sides}>d{sides}</option>
            ))}
          </select>
        </label>
        <label>
          Count
          <input
            aria-label="Number of dice"
            type="number"
            min={1}
            max={20}
            value={diceCount}
            onChange={(e) => setDiceCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <label>
          Modifier
          <input
            aria-label="Dice modifier"
            type="number"
            min={-999}
            max={999}
            value={diceModifier}
            onChange={(e) => setDiceModifier(Math.min(999, Math.max(-999, Number(e.target.value) || 0)))}
          />
        </label>
        <button onClick={() => props.onRollDice(diceSides, diceCount, diceModifier)}>Roll</button>
        {props.lastDiceRoll && (
          <p className="dice-result" role="status" aria-live="polite">
            <strong>{props.lastDiceRoll.roller}</strong> rolled {props.lastDiceRoll.count}d{props.lastDiceRoll.sides}
            {props.lastDiceRoll.modifier > 0 ? ` + ${props.lastDiceRoll.modifier}` : ''}
            {props.lastDiceRoll.modifier < 0 ? ` - ${Math.abs(props.lastDiceRoll.modifier)}` : ''}
            : [{props.lastDiceRoll.rolls.join(', ')}] = <strong>{props.lastDiceRoll.total}</strong>
          </p>
        )}
      </section>
    </div>
  )
}
