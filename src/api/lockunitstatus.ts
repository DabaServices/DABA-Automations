import { APIRequestContext } from '@playwright/test';
import { BACKEND_URL } from '../../playwright.config';

/**
 * Lock/Unlock Unit Status API
 * 
 * Provides a function to manage unit lock/unlock status via API.
 * Takes unit number, parent unit number, lock status (0=unlock, 1=lock), and optional date.
 */

const API_BASE_URL = BACKEND_URL;

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
  const url = `${API_BASE_URL}/statuses`;
  
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
    'screendate': currentDate
  };

  const statusText = lockStatus === 1 ? 'LOCK' : 'UNLOCK';
  const action = lockStatus === 1 ? 'Locking' : 'Unlocking';

  const response = await request.post(url, { data: payload, headers });

  const status = response.status();
  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = await response.text();
  }
  
  if (status !== 201) {
    const errorMsg = `Failed to ${statusText} units [${unitIds.join(', ')}]. Status: ${status}`;
    console.error(`[lockUnitStatus] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  return responseBody;
}
