const cron = require('node-cron');
const Notebook = require('../models/Notebook');
const Board = require('../models/Board');

const RETENTION_DAYS = 30;

let task = null;

/**
 * Permanently delete items that have been in the recycle bin for more than 30 days.
 *
 * Runs once daily. Finds Notebooks and Boards where deletedAt < (now - 30 days)
 * and hard-deletes them (files, AI sessions where possible, and DB records).
 */
async function purgeExpiredTrashItems() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    try {
        // ── Notebooks ─────────────────────────────────────────────────────────────
        const expiredNotebooks = await Notebook.find({ deletedAt: { $lt: cutoff } });

        if (expiredNotebooks.length > 0) {
            console.log(`[recycleBinCleanup] Found ${expiredNotebooks.length} expired notebook(s) to purge.`);

            const fs = require('fs').promises;

            for (const notebook of expiredNotebooks) {
                try {
                    // Delete source files from disk
                    for (const source of notebook.sources) {
                        if (source.filePath) {
                            try { await fs.unlink(source.filePath); } catch { /* file may already be gone */ }
                        }
                    }
                    await notebook.deleteOne();
                    console.log(`[recycleBinCleanup] Purged notebook ${notebook._id} (deleted ${notebook.deletedAt.toISOString()}).`);
                } catch (err) {
                    console.error(`[recycleBinCleanup] Error purging notebook ${notebook._id}:`, err.message);
                }
            }
        }

        // ── Boards ─────────────────────────────────────────────────────────────────
        const boardResult = await Board.deleteMany({ deletedAt: { $lt: cutoff } });

        if (boardResult.deletedCount > 0) {
            console.log(`[recycleBinCleanup] Purged ${boardResult.deletedCount} expired board(s).`);
        }
    } catch (err) {
        console.error('[recycleBinCleanup] Error running cleanup:', err.message);
    }
}

/**
 * Start the cron job — runs daily at midnight UTC.
 */
function startRecycleBinCleanupJob() {
    // Run once on startup to catch anything missed
    purgeExpiredTrashItems();

    // Schedule daily at 00:00 UTC
    task = cron.schedule('0 0 * * *', purgeExpiredTrashItems, {
        scheduled: true,
        timezone: 'UTC',
    });

    console.log('[recycleBinCleanup] Cron job started (daily at midnight UTC).');
}

/**
 * Stop the cron job gracefully.
 */
function stopRecycleBinCleanupJob() {
    if (task) {
        task.stop();
        task = null;
        console.log('[recycleBinCleanup] Cron job stopped.');
    }
}

module.exports = {
    startRecycleBinCleanupJob,
    stopRecycleBinCleanupJob,
    purgeExpiredTrashItems, // exported for testing
};
