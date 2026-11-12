import type { EmergencyAlert } from '../types/assessment'
import { sanitizeClinicalAiText } from '../utils/aiTextSanitizer'

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

interface FastAPIValidationErrorItem {
  loc?: Array<string | number>
  msg?: string
}

interface FastAPIErrorPayload {
  detail?: string | FastAPIValidationErrorItem[]
  emergency_alert?: EmergencyAlert
  generated_by_gemini?: boolean
}

export class ApiRequestError extends Error {
  status: number
  emergencyAlert: EmergencyAlert | null

  constructor(
    message: string,
    status = 0,
    emergencyAlert: EmergencyAlert | null = null,
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.emergencyAlert = emergencyAlert
  }
}

export function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return sanitizeClinicalAiText(fallback)
  }
  const detail = (payload as FastAPIErrorPayload).detail
  if (typeof detail === 'string' && detail.trim()) {
    return sanitizeClinicalAiText(detail)
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return sanitizeClinicalAiText(
      detail
        .map((item) => {
          const field = item.loc ? item.loc[item.loc.length - 1] : 'input'
          return `${String(field)}: ${item.msg ?? 'invalid value'}`
        })
        .join('; '),
    )
  }
  return sanitizeClinicalAiText(fallback)
}

function extractEmergencyAlert(payload: unknown): EmergencyAlert | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const candidate = (payload as FastAPIErrorPayload).emergency_alert
  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.emergency_detected === 'boolean'
  ) {
    return candidate
  }
  return null
}

async function performFetch<T>(
  path: string,
  options: RequestInit,
  timeoutMs: number,
  networkErrorMessage: string,
  isFormData: boolean,
): Promise<T> {
  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        Accept: 'application/json',
        ...(!isFormData && options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    })
  } catch (err: unknown) {
    clearTimeout(timerId)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiRequestError(
        `Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Confirm the backend and clinical AI services are responsive.`,
        408,
      )
    }
    throw new ApiRequestError(networkErrorMessage, 0)
  } finally {
    clearTimeout(timerId)
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiRequestError(
      extractErrorMessage(
        data,
        `Request failed with status HTTP ${response.status}.`,
      ),
      response.status,
      extractEmergencyAlert(data),
    )
  }

  return data as T
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  networkErrorMessage = 'Unable to connect to the backend API. Confirm FastAPI is running.',
  timeoutMs = 45000,
): Promise<T> {
  return performFetch<T>(path, options, timeoutMs, networkErrorMessage, false)
}

export async function requestFormData<T>(
  path: string,
  formData: FormData,
  networkErrorMessage = 'Unable to connect to the backend API during document upload.',
  timeoutMs = 60000,
): Promise<T> {
  return performFetch<T>(
    path,
    {
      method: 'POST',
      body: formData,
    },
    timeoutMs,
    networkErrorMessage,
    true,
  )
}
