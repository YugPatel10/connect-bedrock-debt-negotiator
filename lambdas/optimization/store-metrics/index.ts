/**
 * store-metrics Lambda
 *
 * Input: { batchMetrics, templateId, patternSummary, updatedAt }
 * Writes BatchMetrics to strategy-logs/metrics/{campaignBatchId}/aggregated-metrics.json
 * Writes strategy update history to strategy-logs/optimization-history/{campaignBatchId}/strategy-updates.json
 *
 * Requirements: 8.4
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BatchMetrics } from '../../../lib/types.js';

const s3 = new S3Client({});

const STRATEGY_LOGS_BUCKET = process.env.STRATEGY_LOGS_BUCKET_NAME!;

export interface StoreMetricsInput {
  batchMetrics: BatchMetrics;
  templateId: string;
  patternSummary: string;
  updatedAt: string;
}

export interface StoreMetricsOutput {
  stored: true;
}

export const handler = async (event: StoreMetricsInput): Promise<StoreMetricsOutput> => {
  const { batchMetrics, templateId, patternSummary, updatedAt } = event;
  const { campaignBatchId } = batchMetrics;

  // Write aggregated metrics
  const metricsKey = `strategy-logs/metrics/${campaignBatchId}/aggregated-metrics.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: STRATEGY_LOGS_BUCKET,
      Key: metricsKey,
      Body: JSON.stringify({ ...batchMetrics, storedAt: updatedAt }),
      ContentType: 'application/json',
    }),
  );

  // Write strategy update history
  const historyKey = `strategy-logs/optimization-history/${campaignBatchId}/strategy-updates.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: STRATEGY_LOGS_BUCKET,
      Key: historyKey,
      Body: JSON.stringify({
        campaignBatchId,
        templateId,
        patternSummary,
        metrics: batchMetrics,
        updatedAt,
      }),
      ContentType: 'application/json',
    }),
  );

  return { stored: true };
};
