export type HealthCondition = 'red' | 'amber' | 'green'

export function getHealthCondition(hp: number, maxHp: number): HealthCondition {
  const remaining = maxHp > 0 ? hp / maxHp : 0
  if (remaining <= 0.25) return 'red'
  if (remaining <= 0.5) return 'amber'
  return 'green'
}

export function getHealthColor(condition: HealthCondition): string {
  switch (condition) {
    case 'red':
      return '#ff6b6b'
    case 'amber':
      return '#f5c451'
    case 'green':
      return '#72d18b'
  }
}
