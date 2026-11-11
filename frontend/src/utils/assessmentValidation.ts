import type {
  AssessmentDraft,
  ClinicalMeasurementsInput,
  PreprocessingSummary,
} from '../types/assessment'
import type { DiabetesPredictionInput } from '../types/prediction'

export type PimaFeatureKey = keyof DiabetesPredictionInput

export interface PimaFeatureConfig {
  key: PimaFeatureKey
  label: string
  unit: string
  min: number
  max: number
  plausibleMin?: number
  step: string
  integerOnly?: boolean
  zeroAsMissing?: boolean
  hint: string
}

export const PIMA_FEATURE_FIELDS: PimaFeatureConfig[] = [
  {
    key: 'Pregnancies',
    label: 'Pregnancies',
    unit: 'count',
    min: 0,
    max: 20,
    step: '1',
    integerOnly: true,
    hint: 'Whole number 0–20 (0 is retained as zero)',
  },
  {
    key: 'Glucose',
    label: 'Glucose',
    unit: 'mg/dL',
    min: 0,
    plausibleMin: 30,
    max: 500,
    step: 'any',
    zeroAsMissing: true,
    hint: '30–500 mg/dL, or 0 for Pima missing-value median imputation',
  },
  {
    key: 'BloodPressure',
    label: 'Blood Pressure (Diastolic)',
    unit: 'mm Hg',
    min: 0,
    plausibleMin: 20,
    max: 200,
    step: 'any',
    zeroAsMissing: true,
    hint: '20–200 mm Hg, or 0 for Pima missing-value median imputation',
  },
  {
    key: 'SkinThickness',
    label: 'Skin Thickness',
    unit: 'mm',
    min: 0,
    plausibleMin: 5,
    max: 100,
    step: 'any',
    zeroAsMissing: true,
    hint: '5–100 mm, or 0 for Pima missing-value median imputation',
  },
  {
    key: 'Insulin',
    label: 'Insulin (2-hr Serum)',
    unit: 'mu U/ml',
    min: 0,
    plausibleMin: 2,
    max: 900,
    step: 'any',
    zeroAsMissing: true,
    hint: '2–900 mu U/ml, or 0 for Pima missing-value median imputation',
  },
  {
    key: 'BMI',
    label: 'BMI',
    unit: 'kg/m²',
    min: 0,
    plausibleMin: 10,
    max: 80,
    step: 'any',
    zeroAsMissing: true,
    hint: '10–80 kg/m², or 0 for Pima missing-value median imputation',
  },
  {
    key: 'DiabetesPedigreeFunction',
    label: 'Diabetes Pedigree Function',
    unit: 'score',
    min: 0.05,
    max: 3.0,
    step: 'any',
    hint: 'Dataset hereditary risk index (0.05–3.0)',
  },
  {
    key: 'Age',
    label: 'Age',
    unit: 'years',
    min: 18,
    max: 110,
    step: '1',
    integerOnly: true,
    hint: 'Whole number 18–110 years (adult dataset cohort)',
  },
]

export const EMPTY_PIMA_VALUES: Record<PimaFeatureKey, string> = {
  Pregnancies: '',
  Glucose: '',
  BloodPressure: '',
  SkinThickness: '',
  Insulin: '',
  BMI: '',
  DiabetesPedigreeFunction: '',
  Age: '',
}

interface VitalValidationRule {
  key: keyof Pick<
    ClinicalMeasurementsInput,
    | 'systolicBp'
    | 'diastolicBp'
    | 'heartRate'
    | 'bodyTemperature'
    | 'oxygenSaturation'
  >
  label: string
  unit: string
  techMin: number
  techMax: number
  unusualLow?: number
  unusualHigh?: number
}

const VITAL_RULES: VitalValidationRule[] = [
  {
    key: 'systolicBp',
    label: 'Systolic Blood Pressure',
    unit: 'mm Hg',
    techMin: 50,
    techMax: 280,
    unusualLow: 90,
    unusualHigh: 140,
  },
  {
    key: 'diastolicBp',
    label: 'Diastolic Blood Pressure',
    unit: 'mm Hg',
    techMin: 30,
    techMax: 180,
    unusualLow: 60,
    unusualHigh: 90,
  },
  {
    key: 'heartRate',
    label: 'Heart Rate',
    unit: 'bpm',
    techMin: 25,
    techMax: 250,
    unusualLow: 50,
    unusualHigh: 110,
  },
  {
    key: 'bodyTemperature',
    label: 'Body Temperature',
    unit: '°C',
    techMin: 30,
    techMax: 45,
    unusualLow: 35.5,
    unusualHigh: 38.0,
  },
  {
    key: 'oxygenSaturation',
    label: 'Oxygen Saturation (SpO₂)',
    unit: '%',
    techMin: 40,
    techMax: 100,
    unusualLow: 94,
  },
]

export function evaluateClinicalMeasurements(
  measurements: ClinicalMeasurementsInput,
): {
  vitalErrors: Record<string, string>
  vitalWarnings: Record<string, string>
} {
  const vitalErrors: Record<string, string> = {}
  const vitalWarnings: Record<string, string> = {}
  const parsedValues: Partial<Record<VitalValidationRule['key'], number>> = {}

  for (const rule of VITAL_RULES) {
    const raw = measurements[rule.key].trim()
    if (!raw) continue

    const num = Number(raw)
    if (!Number.isFinite(num)) {
      vitalErrors[rule.key] = `${rule.label} must be a valid finite number (${rule.unit}).`
      continue
    }

    if (num < rule.techMin || num > rule.techMax) {
      vitalErrors[rule.key] =
        `${rule.label} (${num} ${rule.unit}) is outside the accepted technical entry bounds (${rule.techMin}–${rule.techMax} ${rule.unit}).`
      continue
    }

    parsedValues[rule.key] = num

    if (rule.unusualLow !== undefined && num < rule.unusualLow) {
      vitalWarnings[rule.key] =
        `Unusual reading: ${num} ${rule.unit} is low (< ${rule.unusualLow} ${rule.unit}). Accepted without blocking.`
    } else if (rule.unusualHigh !== undefined && num > rule.unusualHigh) {
      vitalWarnings[rule.key] =
        `Unusual reading: ${num} ${rule.unit} is elevated (> ${rule.unusualHigh} ${rule.unit}). Accepted without blocking.`
    }
  }

  if (
    parsedValues.systolicBp !== undefined &&
    parsedValues.diastolicBp !== undefined &&
    parsedValues.systolicBp <= parsedValues.diastolicBp
  ) {
    vitalErrors.systolicBp =
      'Systolic Blood Pressure (mm Hg) must be higher than Diastolic Blood Pressure.'
  }

  return { vitalErrors, vitalWarnings }
}

export function computeAgeYears(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(`${dateOfBirth}T00:00:00`)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1
  }
  return age >= 0 ? age : null
}

export function createEmptyDraft(): AssessmentDraft {
  return {
    patientInfo: {
      patientMode: 'new',
      existingPatientId: '',
      patientCode: '',
      fullName: '',
      dateOfBirth: '',
      sex: '',
      contactNumber: '',
      demographicsNotes: '',
    },
    symptomsHistory: {
      currentSymptoms: '',
      symptomDuration: '',
      previousConditions: '',
      existingMedications: '',
      knownAllergies: '',
      medicalHistoryNotes: '',
    },
    clinicalMeasurements: {
      systolicBp: '',
      diastolicBp: '',
      heartRate: '',
      bodyTemperature: '',
      oxygenSaturation: '',
      additionalMeasurements: '',
    },
    medicalRecords: {
      labResults: '',
      ehrSummary: '',
      previousReports: '',
      attachedReportNames: [],
    },
    medicalImages: {
      attachedImages: [],
      imagingNotes: '',
    },
    genomicInfo: {
      genomicNotes: '',
      familyHistoryMarkers: '',
    },
    includeDiabetesExperiment: false,
    diabetesFeatures: { ...EMPTY_PIMA_VALUES },
  }
}

export function validatePimaFeatureStrings(
  values: Record<PimaFeatureKey, string>,
): {
  parsed: DiabetesPredictionInput | null
  errors: Partial<Record<PimaFeatureKey, string>>
} {
  const errors: Partial<Record<PimaFeatureKey, string>> = {}
  const parsed: Partial<DiabetesPredictionInput> = {}

  for (const field of PIMA_FEATURE_FIELDS) {
    const raw = values[field.key].trim()
    if (!raw) {
      errors[field.key] = `${field.label} is required when running this experiment.`
      continue
    }

    const num = Number(raw)
    if (!Number.isFinite(num)) {
      errors[field.key] = `${field.label} must be a valid finite number.`
      continue
    }

    if (field.integerOnly && !Number.isInteger(num)) {
      errors[field.key] = `${field.label} must be a whole number.`
      continue
    }

    if (field.zeroAsMissing && field.plausibleMin !== undefined) {
      if (num < 0 || num > field.max || (num !== 0 && num < field.plausibleMin)) {
        errors[field.key] =
          `${field.label} must be 0 (missing-value code) or between ${field.plausibleMin} and ${field.max} ${field.unit}.`
        continue
      }
    } else if (num < field.min || num > field.max) {
      errors[field.key] =
        `${field.label} must be between ${field.min} and ${field.max} ${field.unit}.`
      continue
    }

    parsed[field.key] = num
  }

  if (Object.keys(errors).length > 0) {
    return { parsed: null, errors }
  }

  return { parsed: parsed as DiabetesPredictionInput, errors: {} }
}

export function validateAssessmentDraft(draft: AssessmentDraft): {
  generalError: string | null
  patientErrors: Record<string, string>
  vitalErrors: Record<string, string>
  vitalWarnings: Record<string, string>
  pimaErrors: Partial<Record<PimaFeatureKey, string>>
  parsedPima: DiabetesPredictionInput | null
} {
  const patientErrors: Record<string, string> = {}

  if (draft.patientInfo.patientMode === 'existing') {
    if (!draft.patientInfo.existingPatientId.trim()) {
      patientErrors.existingPatientId = 'Select an existing patient record.'
    }
  } else {
    const fullName = draft.patientInfo.fullName.trim()
    if (fullName.length < 2 || fullName.length > 150) {
      patientErrors.fullName = 'Full name is required (2–150 characters).'
    }

    const dobRaw = draft.patientInfo.dateOfBirth.trim()
    if (!dobRaw) {
      patientErrors.dateOfBirth = 'Date of birth is required for a new patient.'
    } else {
      const dob = new Date(`${dobRaw}T00:00:00`)
      if (Number.isNaN(dob.getTime()) || dob > new Date()) {
        patientErrors.dateOfBirth = 'Enter a valid past date of birth.'
      }
    }

    const code = draft.patientInfo.patientCode.trim()
    if (code && (code.length < 2 || code.length > 50)) {
      patientErrors.patientCode = 'Patient code must be 2–50 characters if provided.'
    }

    if (draft.patientInfo.contactNumber.trim().length > 20) {
      patientErrors.contactNumber = 'Contact number must be 20 characters or fewer.'
    }
  }

  const { vitalErrors, vitalWarnings } = evaluateClinicalMeasurements(
    draft.clinicalMeasurements,
  )

  const hasAnyClinicalInput = Boolean(
    draft.patientInfo.demographicsNotes.trim() ||
      draft.symptomsHistory.currentSymptoms.trim() ||
      draft.symptomsHistory.symptomDuration.trim() ||
      draft.symptomsHistory.previousConditions.trim() ||
      draft.symptomsHistory.existingMedications.trim() ||
      draft.symptomsHistory.knownAllergies.trim() ||
      draft.symptomsHistory.medicalHistoryNotes.trim() ||
      draft.clinicalMeasurements.systolicBp.trim() ||
      draft.clinicalMeasurements.diastolicBp.trim() ||
      draft.clinicalMeasurements.heartRate.trim() ||
      draft.clinicalMeasurements.bodyTemperature.trim() ||
      draft.clinicalMeasurements.oxygenSaturation.trim() ||
      draft.clinicalMeasurements.additionalMeasurements.trim() ||
      draft.medicalRecords.labResults.trim() ||
      draft.medicalRecords.ehrSummary.trim() ||
      draft.medicalRecords.previousReports.trim() ||
      draft.medicalRecords.attachedReportNames.length > 0 ||
      draft.medicalImages.attachedImages.length > 0 ||
      draft.medicalImages.imagingNotes.trim() ||
      draft.genomicInfo.genomicNotes.trim() ||
      draft.genomicInfo.familyHistoryMarkers.trim() ||
      draft.includeDiabetesExperiment,
  )

  let generalError: string | null = null
  if (!hasAnyClinicalInput) {
    generalError =
      'Enter at least one clinical observation, measurement, record, image, or genomic note before saving the assessment.'
  }

  let pimaErrors: Partial<Record<PimaFeatureKey, string>> = {}
  let parsedPima: DiabetesPredictionInput | null = null
  if (draft.includeDiabetesExperiment) {
    const pimaValidation = validatePimaFeatureStrings(draft.diabetesFeatures)
    pimaErrors = pimaValidation.errors
    parsedPima = pimaValidation.parsed
  }

  return {
    generalError,
    patientErrors,
    vitalErrors,
    vitalWarnings,
    pimaErrors,
    parsedPima,
  }
}

export function buildPreprocessingSummary(
  draft: AssessmentDraft,
  unusualWarnings: string[] = [],
): PreprocessingSummary {
  const providedModalities: string[] = ['Patient Demographics']
  const missingModalities: string[] = []

  const hasSymptoms = Boolean(
    draft.symptomsHistory.currentSymptoms.trim() ||
      draft.symptomsHistory.symptomDuration.trim() ||
      draft.symptomsHistory.previousConditions.trim() ||
      draft.symptomsHistory.existingMedications.trim() ||
      draft.symptomsHistory.knownAllergies.trim() ||
      draft.symptomsHistory.medicalHistoryNotes.trim(),
  )
  ;(hasSymptoms ? providedModalities : missingModalities).push(
    'Symptoms & Medical History',
  )

  const vitalKeys = [
    draft.clinicalMeasurements.systolicBp,
    draft.clinicalMeasurements.diastolicBp,
    draft.clinicalMeasurements.heartRate,
    draft.clinicalMeasurements.bodyTemperature,
    draft.clinicalMeasurements.oxygenSaturation,
  ]
  const validatedMeasurementsCount = vitalKeys.filter((v) => v.trim() !== '').length
  const hasMeasurements =
    validatedMeasurementsCount > 0 ||
    Boolean(draft.clinicalMeasurements.additionalMeasurements.trim())
  ;(hasMeasurements ? providedModalities : missingModalities).push(
    'Clinical Measurements',
  )

  const hasRecords = Boolean(
    draft.medicalRecords.labResults.trim() ||
      draft.medicalRecords.ehrSummary.trim() ||
      draft.medicalRecords.previousReports.trim() ||
      draft.medicalRecords.attachedReportNames.length > 0,
  )
  ;(hasRecords ? providedModalities : missingModalities).push(
    'Medical Records & Reports',
  )

  const hasImages = Boolean(
    draft.medicalImages.attachedImages.length > 0 ||
      draft.medicalImages.imagingNotes.trim(),
  )
  ;(hasImages ? providedModalities : missingModalities).push('Medical Images')

  const hasGenomic = Boolean(
    draft.genomicInfo.genomicNotes.trim() ||
      draft.genomicInfo.familyHistoryMarkers.trim(),
  )
  ;(hasGenomic ? providedModalities : missingModalities).push('Genomic Information')

  let imputationAppliedNote: string | null = null
  if (draft.includeDiabetesExperiment) {
    const zeroImputedCols = [
      'Glucose',
      'BloodPressure',
      'SkinThickness',
      'Insulin',
      'BMI',
    ].filter((key) => Number(draft.diabetesFeatures[key as PimaFeatureKey]) === 0)
    imputationAppliedNote =
      zeroImputedCols.length > 0
        ? `Zero-as-missing median imputation applied by backend for: ${zeroImputedCols.join(', ')}.`
        : 'All 8 Pima predictive features supplied with non-zero physiological measurements.'
  }

  return {
    providedModalities,
    missingModalities,
    validatedMeasurementsCount,
    unusualMeasurementWarnings:
      unusualWarnings.length > 0 ? unusualWarnings : undefined,
    imputationAppliedNote,
  }
}
