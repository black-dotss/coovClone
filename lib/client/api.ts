/**
 * Typed client API utility for CookMyCV frontend
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers,
  });

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    return (await response.text()) as unknown as T;
  }

  const json: ApiResponse<T> = await response.json();

  if (!response.ok || !json.success) {
    const errorMsg = json.error?.message || `Request failed (${response.status})`;
    const error = new Error(errorMsg);
    (error as unknown as { code?: string; details?: unknown }).code = json.error?.code;
    (error as unknown as { code?: string; details?: unknown }).details = json.error?.details;
    throw error;
  }

  return json.data as T;
}
