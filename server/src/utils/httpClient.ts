import axios, { AxiosInstance } from 'axios';

/**
 * Create a configured axios instance for external API calls.
 */
export function createHttpClient(baseURL: string, timeoutMs = 15_000): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
