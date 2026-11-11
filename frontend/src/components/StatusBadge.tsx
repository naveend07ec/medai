export type ProjectStatus =
  | 'Completed Experiment'
  | 'Research Prototype'
  | 'In Development'
  | 'Planned'

interface StatusBadgeProps {
  status: ProjectStatus
}

function getStatusClass(status: ProjectStatus): string {
  switch (status) {
    case 'Completed Experiment':
      return 'status-badge status-completed'
    case 'Research Prototype':
      return 'status-badge status-prototype'
    case 'In Development':
      return 'status-badge status-development'
    case 'Planned':
      return 'status-badge status-planned'
  }
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={getStatusClass(status)}>{status}</span>
}
