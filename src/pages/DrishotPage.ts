import { Page } from '@playwright/test';
import { MainPage } from './MainPage';

/**
 * DrishotPage - Extends MainPage.
 * Placeholder for Drishot-specific logic.
 */
export class DrishotPage extends MainPage {
  constructor(page: Page) {
    super(page);
  }
}
