import type {
  DiabetesPredictionInput,
  DiabetesPredictionResponse,
  PredictiveModelHealth,
} from '../types/prediction'
import { requestJson } from './client'

export async function fetchDiabetesModelHealth(): Promise<PredictiveModelHealth> {
  return requestJson<PredictiveModelHealth>(
    '/api/v1/predictions/diabetes/health',
    { method: 'GET' },
    'Unable to reach the backend API. Confirm the FastAPI server is running.',
  )
}

export async function submitDiabetesPrediction(
  payload: DiabetesPredictionInput,
): Promise<DiabetesPredictionResponse> {
  return requestJson<DiabetesPredictionResponse>(
    '/api/v1/predictions/diabetes',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Unable to connect to the backend prediction service. Confirm FastAPI is running and CORS is configured.',
  )
}
