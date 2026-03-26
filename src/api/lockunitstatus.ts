import { APIRequestContext } from '@playwright/test';

/**
 * Lock/Unlock Unit Status API
 * 
 * Provides a function to manage unit lock/unlock status via API.
 * Takes unit number, parent unit number, lock status (0=unlock, 1=lock), and optional date.
 */

const API_BASE_URL = 'http://162.55.55.124:3000';

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
 * @param fatherNumber - The parent unit ID (context for the operation)
 * @param lockStatus - 0 to unlock, 1 to lock the units
 * @param screenDate - Date string in format 'YYYY-MM-DD' (optional, defaults to today)
 * @returns API response from the server
 * 
 * @example
 * // Unlock single unit 52 with parent 2 (today's date)
 * await lockUnitStatus(request, [52], 2, 0);
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
  fatherNumber: number,
  lockStatus: 0 | 1,
  screenDate?: string
): Promise<any> {
  const url = `${API_BASE_URL}/statuses`;
  
  // Use today's date if not provided
  const currentDate = screenDate || getTodayDate();
  
  const payload = {
    unitsIds: unitIds,
    statusId: lockStatus,
    updateHierarchy: false
  };

  const headers = {
    'Content-Type': 'application/json',
    'authorization': 'Bearer',
    'unit': fatherNumber.toString(),
    'screendate': currentDate
  };

  const statusText = lockStatus === 1 ? 'LOCK' : 'UNLOCK';
  console.log(`\n[LOCK UNIT STATUS API]`);
  console.log(`  POST ${url}`);
  console.log(`  Units: [${unitIds.join(', ')}]`);
  console.log(`  Parent: ${fatherNumber}`);
  console.log(`  Action: ${statusText}`);
  console.log(`  Date: ${currentDate}`);

  const response = await request.post(url, { data: payload, headers });

  const status = response.status();
  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = await response.text();
  }

  console.log(`  Response Status: ${status}`);
  
  if (status !== 201) {
    const errorMsg = `Failed to ${statusText} units [${unitIds.join(', ')}]. Status: ${status}, Body: ${JSON.stringify(responseBody)}`;
    console.error(`  ✗ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.log(`  ✓ Units [${unitIds.join(', ')}] ${statusText} successful`);
  return responseBody;
}
