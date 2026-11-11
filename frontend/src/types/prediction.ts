export interface DiabetesPredictionInput {
  Pregnancies: number
  Glucose: number
  BloodPressure: number
  SkinThickness: number
  Insulin: number
  BMI: number
  DiabetesPedigreeFunction: number
  Age: number
}

export interface DiabetesPredictionResponse {
  predicted_class: 0 | 1
  class_0_probability: number
  class_1_probability: number
  model_name: string
  model_version: string
  module_name: string
  clinical_disclaimer: string
}

export interface PredictiveModelHealth {
  module_name: string
  model_name: string
  model_version: string
  status: 'ready' | 'unavailable'
  model_loaded: boolean
  imputation_loaded: boolean
  detail: string | null
}

