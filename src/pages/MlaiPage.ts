import { Page } from '@playwright/test';
import { ShechelPage } from './ShechelPage';

/**
 * MlaiPage - Extends ShechelPage.
 * Successor/child page for Mlai-specific logic.
 */
export class MlaiPage extends ShechelPage {
  constructor(page: Page) {
    super(page);
  }
}
