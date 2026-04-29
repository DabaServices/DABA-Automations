import { Page } from '@playwright/test';
import { MainPage } from './MainPage';

/**
 * HakchaotPage - Extends MainPage.
 * Placeholder for Hakchaot-specific logic.
 */
export class HakchaotPage extends MainPage {
  constructor(page: Page) {
    super(page);
  }
}
