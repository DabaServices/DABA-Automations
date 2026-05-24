import { APIRequestContext } from '@playwright/test';
import { BACKEND_URL } from '../../playwright.config';
import { ClientError } from './reportUnits';

/**
 * Lock/Unlock Unit Status API
 * 
 * Provides a function to manage unit lock/unlock status via API.
 * Takes unit number, parent unit number, lock status (0=unlock, 1=lock), and optional date.
 */

const API_BASE_URL = BACKEND_URL;
const DEFAULT_USER = 'S9107544';

/**
 * Get today's date in YYYY-MM-DD format
 * Uses JavaScript's built-in Date object
 */
const getTodayDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Change lock status of one or more units via API
 * 
 * @param request - Playwright APIRequestContext for making HTTP calls
 * @param unitIds - Array of unit IDs to update (can be single unit or multiple units)
 * @param requestingUnitId - The unit ID that is performing the request (used in headers)
 * @param lockStatus - 0 to unlock, 1 to lock the units
 * @param screenDate - Date string in format 'YYYY-MM-DD' (optional, defaults to today)
 * @returns API response from the server
 * 
 * @example
 * // Unlock single unit 52 as unit 1 (today's date)
 * await lockUnitStatus(request, [52], 1, 0);
 * 
 * // Unlock multiple units on a specific date
 * await lockUnitStatus(request, [10, 2, 3, 4, 5], 1, 0, '2026-03-25');
 * 
 * // Lock multiple units
 * await lockUnitStatus(request, [10, 2, 3], 1, 1);
 */
export async function lockUnitStatus(
  request: APIRequestContext,
  unitIds: number[],
  requestingUnitId: number,
  lockStatus: 0 | 1,
  screenDate?: string,
  updateHierarchyOverride?: boolean
): Promise<any> {
  const url = `${API_BASE_URL}/statuses?user=${encodeURIComponent(DEFAULT_USER)}`;
  
  // Use today's date if not provided
  const currentDate = screenDate || getTodayDate();
  
  // CRITICAL: updateHierarchy logic:
  // - Always true to ensure aggregation is recalculated on every lock/unlock
  // - Can be overridden explicitly via updateHierarchyOverride
  const updateHierarchy = updateHierarchyOverride ?? (lockStatus === 1);
  
  const payload = {
    unitsIds: unitIds,
    statusId: lockStatus,
    updateHierarchy: updateHierarchy
  };

  const headers = {
    'Content-Type': 'application/json',
    'authorization': 'Bearer',
    'unit': requestingUnitId.toString(),
    'screendate': currentDate,
    'user': DEFAULT_USER,
  };

  const statusText = lockStatus === 1 ? 'LOCK' : 'UNLOCK';
  const action = lockStatus === 1 ? 'Locking' : 'Unlocking';

  // Retry transient network errors so a brief DNS / connection blip doesn't
  // fail the whole test. We do NOT retry on a 4xx — that's a real client error.
  const maxAttempts = 4;
  let response: any;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await request.post(url, { data: payload, headers, timeout: 20_000 });
      break;
    } catch (e) {
      lastError = e;
      const msg = String((e as Error)?.message ?? e);
      const isTransient =
        msg.includes('ENOTFOUND') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('socket hang up');
      if (attempt === maxAttempts || !isTransient) throw e;
      const wait = 1000 * attempt;
      console.warn(
        `[lockUnitStatus] ${action} attempt ${attempt}/${maxAttempts} network error (${msg.slice(0, 100)}); retrying in ${wait}ms…`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!response) throw lastError;

  const status = response.status();
  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = await response.text();
  }
  
  if (status !== 201) {
    const bodyPreview =
      typeof responseBody === 'string'
        ? responseBody.slice(0, 200)
        : JSON.stringify(responseBody).slice(0, 200);
    const errorMsg = `Failed to ${statusText} units [${unitIds.join(', ')}]. Status: ${status}. Body: ${bodyPreview}`;
    console.error(`[lockUnitStatus] ${errorMsg}`);
    if (status >= 400 && status < 500) {
      throw new ClientError(errorMsg, status, responseBody);
    }
    throw new Error(errorMsg);
  }
  
  return responseBody;
}
