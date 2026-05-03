/**
 * Persist the full question text on `pending_questions` so the post-click
 * card render can keep it visible alongside the selected answer. Without
 * this, clicking a button replaced the entire card body with just the
 * title + selectedLabel, losing the original question content.
 */
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration014: Migration = {
  version: 14,
  name: 'pending-question-text',
  up(db: Database.Database) {
    db.exec(`ALTER TABLE pending_questions ADD COLUMN question TEXT NOT NULL DEFAULT ''`);
  },
};
