import { useState } from 'react'

export type AnatomyRegionId = 'neuro' | 'cardiopulmonary' | 'metabolic' | 'systemic'

export interface AnatomyClinicalInput {
  symptoms?: string
  conditions?: string
  systolicBp?: number | string | null
  diastolicBp?: number | string | null
  heartRate?: number | string | null
  temperatureC?: number | string | null
  spo2?: number | string | null
  respiratoryRate?: number | string | null
  bloodGlucoseMgDl?: number | string | null
  hba1cPct?: number | string | null
  weightKg?: number | string | null
  heightCm?: number | string | null
  emergencyFlag?: boolean
}

interface RegionSummary {
  id: AnatomyRegionId
  label: string
  subtitle: string
  items: string[]
  attention: boolean
  cx: number
  cy: number
}

interface HumanAnatomyVisualProps {
  mode?: 'hero' | 'clinical'
  clinicalInput?: AnatomyClinicalInput
  compact?: boolean
}

function hasValue(val: number | string | null | undefined): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === 'string') return val.trim().length > 0
  return Number.isFinite(val)
}

function formatNum(val: number | string | null | undefined, suffix = ''): string {
  if (!hasValue(val)) return ''
  return `${val}${suffix ? ` ${suffix}` : ''}`
}

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase()
  return terms.some((term) => lower.includes(term))
}

export function HumanAnatomyVisual({
  mode = 'clinical',
  clinicalInput,
  compact = false,
}: HumanAnatomyVisualProps) {
  const [selectedRegion, setSelectedRegion] = useState<AnatomyRegionId | null>(null)

  const symptoms = clinicalInput?.symptoms?.trim() ?? ''
  const conditions = clinicalInput?.conditions?.trim() ?? ''
  const combinedText = `${symptoms} ${conditions}`.trim()

  const neuroMatched = includesAny(combinedText, [
    'headache',
    'dizz',
    'confusion',
    'blur',
    'vision',
    'migraine',
    'slur',
    'numb',
    'weakness',
    'seizure',
    'neuro',
  ])

  const cardioItems: string[] = []
  if (hasValue(clinicalInput?.systolicBp) || hasValue(clinicalInput?.diastolicBp)) {
    const sbp = hasValue(clinicalInput?.systolicBp) ? clinicalInput?.systolicBp : '—'
    const dbp = hasValue(clinicalInput?.diastolicBp) ? clinicalInput?.diastolicBp : '—'
    cardioItems.push(`Blood Pressure: ${sbp}/${dbp} mm Hg`)
  }
  if (hasValue(clinicalInput?.heartRate)) {
    cardioItems.push(`Heart Rate: ${formatNum(clinicalInput?.heartRate, 'bpm')}`)
  }
  if (hasValue(clinicalInput?.spo2)) {
    cardioItems.push(`SpO₂: ${formatNum(clinicalInput?.spo2, '%')}`)
  }
  if (hasValue(clinicalInput?.respiratoryRate)) {
    cardioItems.push(
      `Respiratory Rate: ${formatNum(clinicalInput?.respiratoryRate, 'breaths/min')}`,
    )
  }
  if (
    includesAny(combinedText, [
      'chest',
      'breath',
      'cough',
      'palpitation',
      'wheez',
      'shortness',
      'hypertension',
      'asthma',
      'heart',
    ])
  ) {
    cardioItems.push('Cardiopulmonary symptoms or history noted')
  }

  const metabolicItems: string[] = []
  if (hasValue(clinicalInput?.bloodGlucoseMgDl)) {
    metabolicItems.push(
      `Blood Glucose: ${formatNum(clinicalInput?.bloodGlucoseMgDl, 'mg/dL')}`,
    )
  }
  if (hasValue(clinicalInput?.hba1cPct)) {
    metabolicItems.push(`HbA1c: ${formatNum(clinicalInput?.hba1cPct, '%')}`)
  }
  if (hasValue(clinicalInput?.weightKg) && hasValue(clinicalInput?.heightCm)) {
    const w = Number(clinicalInput?.weightKg)
    const hM = Number(clinicalInput?.heightCm) / 100
    if (Number.isFinite(w) && Number.isFinite(hM) && hM > 0) {
      const bmi = (w / (hM * hM)).toFixed(1)
      metabolicItems.push(`BMI: ${bmi} kg/m² (${w} kg / ${clinicalInput?.heightCm} cm)`)
    }
  } else if (hasValue(clinicalInput?.weightKg)) {
    metabolicItems.push(`Weight: ${formatNum(clinicalInput?.weightKg, 'kg')}`)
  }
  if (
    includesAny(combinedText, [
      'glucose',
      'diabetes',
      'thirst',
      'urinat',
      'abdom',
      'nausea',
      'stomach',
      'appetite',
      'renal',
      'kidney',
      'metabolic',
    ])
  ) {
    metabolicItems.push('Metabolic or gastrointestinal context noted')
  }

  const systemicItems: string[] = []
  if (hasValue(clinicalInput?.temperatureC)) {
    systemicItems.push(`Temperature: ${formatNum(clinicalInput?.temperatureC, '°C')}`)
  }
  if (
    includesAny(combinedText, [
      'fever',
      'fatigue',
      'tired',
      'chill',
      'sweat',
      'malaise',
      'weight',
      'ache',
    ])
  ) {
    systemicItems.push('Systemic symptoms recorded in intake')
  }

  const regions: RegionSummary[] =
    mode === 'hero'
      ? [
          {
            id: 'neuro',
            label: 'Patient Input',
            subtitle: 'Symptoms & History',
            items: ['Presenting symptoms, duration, history, and medications'],
            attention: true,
            cx: 120,
            cy: 42,
          },
          {
            id: 'cardiopulmonary',
            label: 'Vital Measurements',
            subtitle: 'Clinical Readings',
            items: ['Blood pressure, heart rate, temperature, SpO₂, and notes'],
            attention: true,
            cx: 120,
            cy: 112,
          },
          {
            id: 'metabolic',
            label: 'Diagnostic Output',
            subtitle: 'AI + Medical References',
            items: ['Plain-language possibilities backed by verified references'],
            attention: true,
            cx: 120,
            cy: 174,
          },
        ]
      : [
          {
            id: 'neuro',
            label: 'Neurological & Head',
            subtitle: neuroMatched ? 'Recorded context' : 'No specific entries',
            items: neuroMatched
              ? ['Neurological or head-related symptom context noted in intake']
              : [],
            attention: neuroMatched,
            cx: 120,
            cy: 42,
          },
          {
            id: 'cardiopulmonary',
            label: 'Chest & Cardiopulmonary',
            subtitle:
              cardioItems.length > 0
                ? `${cardioItems.length} recorded signal(s)`
                : 'No vitals recorded',
            items: cardioItems,
            attention: cardioItems.length > 0,
            cx: 120,
            cy: 112,
          },
          {
            id: 'metabolic',
            label: 'Metabolic & Abdominal',
            subtitle:
              metabolicItems.length > 0
                ? `${metabolicItems.length} recorded signal(s)`
                : 'No labs/body metrics',
            items: metabolicItems,
            attention: metabolicItems.length > 0,
            cx: 120,
            cy: 172,
          },
          {
            id: 'systemic',
            label: 'Systemic / General',
            subtitle:
              systemicItems.length > 0
                ? `${systemicItems.length} recorded signal(s)`
                : 'No systemic vitals',
            items: systemicItems,
            attention: systemicItems.length > 0,
            cx: 168,
            cy: 138,
          },
        ]

  const defaultRegion =
    regions.find((r) => r.attention) ?? regions.find((r) => r.id === 'cardiopulmonary') ?? regions[0]
  const activeRegion = regions.find((r) => r.id === selectedRegion) ?? defaultRegion

  return (
    <div
      className={`anatomy-visual-card ${mode === 'hero' ? 'anatomy-visual-hero' : 'anatomy-visual-clinical'} ${compact ? 'anatomy-visual-compact' : ''}`}
      data-testid="human-anatomy-visual"
    >
      <div className="anatomy-svg-stage">
        <svg
          viewBox="0 0 240 360"
          className="anatomy-svg"
          role="img"
          aria-label={
            mode === 'hero'
              ? 'Human anatomical diagram illustrating clinical decision support regions'
              : 'Human anatomical visualization reflecting recorded clinical measurements and symptoms'
          }
        >
          <defs>
            <radialGradient id="anatomyHalo" cx="50%" cy="42%" r="48%">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.12" />
              <stop offset="65%" stopColor="#2563eb" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="bodyShade" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="50%" stopColor="#eef3fa" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>
          </defs>

          {/* Soft Digcy-inspired anatomical halo */}
          <circle cx="120" cy="158" r="108" fill="url(#anatomyHalo)" />
          <ellipse
            cx="120"
            cy="336"
            rx="46"
            ry="7"
            fill="rgba(15, 23, 42, 0.06)"
          />

          {/* Subtle anatomical human silhouette */}
          <g
            fill="url(#bodyShade)"
            stroke="#94a3b8"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Head & neck */}
            <path d="M120 18 C108 18 100 28 100 41 C100 54 108 63 113 65 L112 75 L94 82 C82 86 76 96 72 114 L60 166 C58 174 64 179 69 175 L82 126 L86 122 L84 184 L82 246 L86 322 C86 328 96 328 98 322 L106 238 L115 204 L120 204 L125 204 L134 238 L142 322 C144 328 154 328 154 322 L158 246 L156 184 L154 122 L158 126 L171 175 C176 179 182 174 180 166 L168 114 C164 96 158 86 146 82 L128 75 L127 65 C132 63 140 54 140 41 C140 28 132 18 120 18 Z" />
          </g>

          {/* Clean internal clinical reference hairlines (not sci-fi, architectural) */}
          <g
            fill="none"
            stroke="#64748b"
            strokeOpacity="0.34"
            strokeWidth="1"
            strokeLinecap="round"
          >
            {/* Center axis */}
            <line x1="120" y1="68" x2="120" y2="196" strokeDasharray="2 3" />
            {/* Clavicle contour */}
            <path d="M92 86 Q120 93 148 86" />
            {/* Rib / thoracic contour */}
            <path d="M94 104 Q120 112 146 104" />
            <path d="M96 118 Q120 126 144 118" />
            <path d="M99 132 Q120 139 141 132" />
            {/* Abdominal / pelvic arc */}
            <path d="M96 164 Q120 171 144 164" />
            <path d="M90 190 Q120 200 150 190" />
          </g>

          {/* Region indicator dots (interactive) */}
          {regions.map((region) => {
            const isSelected = activeRegion.id === region.id
            const isEmergency = Boolean(clinicalInput?.emergencyFlag) && region.attention
            const dotColor = isEmergency
              ? '#ea580c'
              : region.attention
                ? '#2563eb'
                : '#94a3b8'
            return (
              <g
                key={region.id}
                className="anatomy-marker-group"
                onClick={() => setSelectedRegion(region.id)}
                role="button"
                tabIndex={0}
                aria-label={`${region.label}: ${region.subtitle}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedRegion(region.id)
                  }
                }}
              >
                {(region.attention || isSelected) && (
                  <circle
                    cx={region.cx}
                    cy={region.cy}
                    r={isSelected ? 13 : 10}
                    fill={dotColor}
                    fillOpacity={isSelected ? 0.16 : 0.1}
                    stroke={dotColor}
                    strokeOpacity={isSelected ? 0.55 : 0.3}
                    strokeWidth="1"
                  />
                )}
                <circle
                  cx={region.cx}
                  cy={region.cy}
                  r={isSelected ? 5.2 : 4.2}
                  fill="#ffffff"
                  stroke={dotColor}
                  strokeWidth="2.4"
                />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="anatomy-region-panel">
        <div className="anatomy-region-tabs" role="tablist" aria-label="Body system regions">
          {regions.map((region) => (
            <button
              key={region.id}
              type="button"
              role="tab"
              aria-selected={activeRegion.id === region.id}
              className={`anatomy-region-tab ${activeRegion.id === region.id ? 'anatomy-region-tab-active' : ''} ${region.attention ? 'anatomy-region-tab-has-data' : ''}`}
              onClick={() => setSelectedRegion(region.id)}
            >
              <span
                className={`anatomy-dot-indicator ${
                  clinicalInput?.emergencyFlag && region.attention
                    ? 'dot-warn'
                    : region.attention
                      ? 'dot-blue'
                      : 'dot-muted'
                }`}
              />
              {region.label}
            </button>
          ))}
        </div>

        <div className="anatomy-region-detail" aria-live="polite">
          <div className="anatomy-region-detail-head">
            <strong>{activeRegion.label}</strong>
            <span>{activeRegion.subtitle}</span>
          </div>
          {activeRegion.items.length > 0 ? (
            <ul className="anatomy-region-list">
              {activeRegion.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="anatomy-region-empty">
              No measurements or symptoms mapped to this region yet.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

