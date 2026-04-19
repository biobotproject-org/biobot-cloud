/**
 * Seed: alert_thresholds
 *
 * Replicates the original hardcoded behaviour (temperature > 80 → high alert)
 * and adds sensible starting thresholds for a wildfire detection system.
 *
 * Existing rows are left untouched (findOrCreate on readingType + operator + thresholdValue).
 *
 * Usage:
 *   node seeders/alert-thresholds.js
 */

require('dotenv').config();
const { AlertThreshold } = require('../models');
const sequelize = require('../config/database');

const RETRY_DELAY_MS = 10_000;

const DEFAULT_THRESHOLDS = [
    {
        readingType:    'temperature',
        operator:       '>',
        thresholdValue: 80,
        severity:       'high',
        message:        'High temperature detected: {value}{unit}',
        enabled:        true
    },
    {
        readingType:    'temperature',
        operator:       '>',
        thresholdValue: 100,
        severity:       'critical',
        message:        'Critical temperature — immediate action required: {value}{unit}',
        enabled:        true
    },

    {
        readingType:    'humidity',
        operator:       '<',
        thresholdValue: 20,
        severity:       'medium',
        message:        'Low humidity warning: {value}{unit}',
        enabled:        true
    },
    {
        readingType:    'humidity',
        operator:       '<',
        thresholdValue: 10,
        severity:       'high',
        message:        'Critically low humidity: {value}{unit}',
        enabled:        true
    },

    {
        readingType:    'smoke',
        operator:       '>',
        thresholdValue: 50,
        severity:       'high',
        message:        'Elevated smoke level detected: {value}{unit}',
        enabled:        true
    },
    {
        readingType:    'smoke',
        operator:       '>',
        thresholdValue: 200,
        severity:       'critical',
        message:        'Critical smoke level — possible fire: {value}{unit}',
        enabled:        true
    },

    {
        readingType:    'co',
        operator:       '>',
        thresholdValue: 35,
        severity:       'medium',
        message:        'Elevated CO level: {value}{unit}',
        enabled:        true
    },
    {
        readingType:    'co',
        operator:       '>',
        thresholdValue: 200,
        severity:       'critical',
        message:        'Dangerous CO level detected: {value}{unit}',
        enabled:        true
    }
];

async function seed() {
    try {
        await sequelize.authenticate();

        let inserted = 0;
        let skipped  = 0;

        for (const row of DEFAULT_THRESHOLDS) {
            const [, created] = await AlertThreshold.findOrCreate({
                where: {
                    readingType:    row.readingType,
                    operator:       row.operator,
                    thresholdValue: row.thresholdValue
                },
                defaults: row
            });
            created ? inserted++ : skipped++;
        }

        console.log(`[seed] alert_thresholds: ${inserted} inserted, ${skipped} already existed.`);
        await sequelize.close();
    } catch (err) {
        console.error('[seed] Failed:', err.message);
        console.log(`[seed] Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
        setTimeout(seed, RETRY_DELAY_MS);
    }
}

seed();