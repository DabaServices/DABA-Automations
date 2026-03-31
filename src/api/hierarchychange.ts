import { APIRequestContext, Page } from '@playwright/test';

/**
 * Hierarchy Change API
 * 
 * Provides a function to update unit hierarchy via API.
 * Moves a unit from one parent to another in the hierarchy tree.
 */

const API_BASE_URL = 'http://localhost:3000';

/**
 * Get today's date in YYYY-MM-DD format
 * Uses JavaScript's built-in Date object
 */
const getTodayDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Update unit hierarchy by moving a unit to a new parent
 * 
 * @param request - Playwright APIRequestContext for making HTTP calls
 * @param lowerUnit - The unit ID to move
 * @param upperUnit - The new parent unit ID
 * @param rootUnit - The root unit ID (usually 1)
 * @param requestingUnitId - The unit ID that is performing the request (used in headers)
 * @param screenDate - Date string in format 'YYYY-MM-DD' (optional, defaults to today)
 * @param page - Playwright Page object (optional). If provided, page will be reloaded after API call
 * @returns API response from the server
 * 
 * @example
 * // Move unit 12 to parent 11 as unit 1 (today's date)
 * await updateUnitHierarchy(request, 12, 11, 1, 1);
 * 
 * // Move unit 12 to parent 11 as unit 2 on a specific date
 * await updateUnitHierarchy(request, 12, 11, 1, 2, '2026-03-25');
 * 
 * // Move unit 12 to parent 11 AND refresh the page
 * await updateUnitHierarchy(request, 12, 11, 1, 1, undefined, page);
 */
export async function updateUnitHierarchy(
  request: APIRequestContext,
  lowerUnit: number,
  upperUnit: number,
  rootUnit: number = 1,
  requestingUnitId?: number,
  screenDate?: string,
  page?: Page
): Promise<any> {
  const url = `${API_BASE_URL}/units/hierarchy`;
  
  // Use rootUnit as requestingUnitId if not provided
  const unitMakingRequest = requestingUnitId ?? rootUnit;
  
  // Use today's date if not provided
  const currentDate = screenDate || getTodayDate();
  
  const payload = {
    lowerUnit: lowerUnit,
    upperUnit: upperUnit,
    rootUnit: rootUnit
  };

  const headers = {
    'Content-Type': 'application/json',
    'authorization': 'Bearer',
    'unit': unitMakingRequest.toString(),
    'screendate': currentDate
  };

  console.info(`[updateUnitHierarchy] Moving unit ${lowerUnit} from current parent to new parent ${upperUnit} as unit ${unitMakingRequest}`);

  const response = await request.put(url, { data: payload, headers });

  const status = response.status();
  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = await response.text();
  }
  
  if (!response.ok()) {
    const errorMsg = `Failed to update hierarchy for unit ${lowerUnit}. Status: ${status}`;
    console.error(`[updateUnitHierarchy] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.info(`[updateUnitHierarchy] Unit ${lowerUnit} successfully moved to parent ${upperUnit}`);
  
  // Refresh page if provided to ensure UI reflects the API change
  if (page) {
    await page.reload();
  }
  
  return responseBody;
}
