import { APIRequestContext } from '@playwright/test';

/**
 * Hierarchy Change API
 * 
 * Provides a function to update unit hierarchy via API.
 * Moves a unit from one parent to another in the hierarchy tree.
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
 * Update unit hierarchy by moving a unit to a new parent
 * 
 * @param request - Playwright APIRequestContext for making HTTP calls
 * @param lowerUnit - The unit ID to move
 * @param upperUnit - The new parent unit ID
 * @param rootUnit - The root unit ID (usually 1)
 * @param screenDate - Date string in format 'YYYY-MM-DD' (optional, defaults to today)
 * @returns API response from the server
 * 
 * @example
 * // Move unit 12 to parent 11 (today's date)
 * await updateUnitHierarchy(request, 12, 11, 1);
 * 
 * // Move unit 12 to parent 11 on a specific date
 * await updateUnitHierarchy(request, 12, 11, 1, '2026-03-25');
 */
export async function updateUnitHierarchy(
  request: APIRequestContext,
  lowerUnit: number,
  upperUnit: number,
  rootUnit: number = 1,
  screenDate?: string
): Promise<any> {
  const url = `${API_BASE_URL}/units/hierarchy`;
  
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
    'unit': rootUnit.toString(),
    'screendate': currentDate
  };

  console.log(`\n[HIERARCHY CHANGE API]`);
  console.log(`  PUT ${url}`);
  console.log(`  Lower Unit (to move): ${lowerUnit}`);
  console.log(`  Upper Unit (new parent): ${upperUnit}`);
  console.log(`  Root Unit: ${rootUnit}`);
  console.log(`  Date: ${currentDate}`);

  const response = await request.put(url, { data: payload, headers });

  const status = response.status();
  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = await response.text();
  }

  console.log(`  Response Status: ${status}`);
  
  if (!response.ok()) {
    const errorMsg = `Failed to update hierarchy. Status: ${status}, Body: ${JSON.stringify(responseBody)}`;
    console.error(`  ✗ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.log(`  ✓ Unit ${lowerUnit} moved to parent ${upperUnit} successfully`);
  return responseBody;
}
