import type { EmergencyAlert } from '../types/assessment'
import { sanitizeClinicalAiText } from '../utils/aiTextSanitizer'

interface EmergencyAlertBannerProps {
  alert: EmergencyAlert
  generatedByGemini?: boolean
  notice?: string | null
}

export function EmergencyAlertBanner({
  alert,
  generatedByGemini,
  notice,
}: EmergencyAlertBannerProps) {
  if (!alert.emergency_detected) {
    return null
  }

  return (
    <div
      className="emergency-alert-banner"
      role="alert"
      aria-live="assertive"
    >
      <div className="emergency-alert-header">
        <span className="emergency-badge">
          {alert.urgency_level === 'emergency'
            ? 'URGENT EMERGENCY RED-FLAG ALERT'
            : 'Safety Alert'}
        </span>
        {generatedByGemini === false && (
          <span className="emergency-source-pill">
            Independent Rule-Based Safety Check
          </span>
        )}
      </div>

      {alert.emergency_guidance && (
        <p className="emergency-guidance-copy">{alert.emergency_guidance}</p>
      )}

      {alert.matched_patterns.length > 0 && (
        <p className="emergency-patterns-copy">
          <strong>Matched warning indicators:</strong>{' '}
          {alert.matched_patterns.join(' • ')}
        </p>
      )}

      {notice && (
        <p className="emergency-notice-copy">{sanitizeClinicalAiText(notice)}</p>
      )}

      <p className="emergency-disclaimer-copy">{alert.triage_disclaimer}</p>
    </div>
  )
}

