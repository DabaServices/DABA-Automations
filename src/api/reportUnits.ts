import { APIRequestContext } from '@playwright/test';
import { BACKEND_URL } from '../../playwright.config';

/**
 * Report Units API
 * 
 * Must be called before locking units or when launching.
 * - Before lock: call with isLaunching = false
 * - On launch: call with isLaunching = true
 */

const API_BASE_URL = BACKEND_URL;

/**
 * Get today's date in YYYY-MM-DD format
 */
const getTodayDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Report units before locking or launching
 * 
 * @param request - Playwright APIRequestContext
 * @param unitsIds - Array of unit IDs to report (the units being locked/launched)
 * @param lowerUnitsIds - Array of all lower unit IDs in the hierarchy
 * @param isLaunching - false when locking, true when launching
 * @param requestingUnitId - The hatunit (top-level unit we are operating from, used in 'unit' header)
 * @param screenDate - Date string 'YYYY-MM-DD' (defaults to today)
 * 
 * @example
 * // Before locking units 2,3 from unit 1
 * await reportUnits(request, [2, 3], [2,3,4,5,6,7,8,9,10], false, 1);
 * 
 * // When launching units 2,3 from unit 1
 * await reportUnits(request, [2, 3], [2,3,4,5,6,7,8,9,10], true, 1);
 */
export async function reportUnits(
  request: APIRequestContext,
  unitsIds: number[],
  lowerUnitsIds: number[],
  isLaunching: boolean,
  requestingUnitId: number,
  screenDate?: string
): Promise<any> {
  const url = `${API_BASE_URL}/reports/committees/report`;

  const currentDate = screenDate || getTodayDate();

  const payload = {
    unitsIds,
    lowerUnitsIds,
    isLaunching
  };

  const headers = {
    'Content-Type': 'application/json',
    'authorization': 'Bearer',
    'unit': requestingUnitId.toString(),
    'screendate': currentDate
  };

  const action = isLaunching ? 'Launching' : 'Reporting (pre-lock)';
  console.log(`[reportUnits] ${action} units [${unitsIds.join(', ')}]`);

  const response = await request.post(url, { data: payload, headers });

  const status = response.status();
  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = await response.text();
  }

  if (status !== 200 && status !== 201) {
    const errorMsg = `Failed to report units [${unitsIds.join(', ')}]. Status: ${status}`;
    console.error(`[reportUnits] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  return responseBody;
}
