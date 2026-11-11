export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

interface FastAPIValidationErrorItem {
  loc?: Array<string | number>
  msg?: string
}

interface FastAPIErrorPayload {
  detail?: string | FastAPIValidationErrorItem[]
}

export function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }
  const detail = (payload as FastAPIErrorPayload).detail
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => {
        const field = item.loc ? item.loc[item.loc.length - 1] : 'input'
        return `${String(field)}: ${item.msg ?? 'invalid value'}`
      })
      .join('; ')
  }
  return fallback
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  networkErrorMessage = 'Unable to connect to the backend API. Confirm FastAPI is running.',
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    })
  } catch {
    throw new Error(networkErrorMessage)
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(
        data,
        `Request failed with status HTTP ${response.status}.`,
      ),
    )
  }

  return data as T
}

