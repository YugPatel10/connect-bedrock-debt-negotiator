/**
 * aggregate-outcomes Lambda
 *
 * Input: OptimizationInput { campaignBatchId, completedAt }
 * Queries Customer_Record via campaignBatchId-index GSI to get all customers in the batch.
 * For each customer, reads their Negotiation_State by contactId (from lastContactDate lookup).
 * Computes BatchMetrics and returns them.
 *
 * Requirements: 8.1
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { OptimizationInput, BatchMetrics } from '../../../lib/types.js';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const CUSTOMER_TABLE = process.env.CUSTOMER_RECORD_TABLE_NAME!;
const NEGOTIATION_TABLE = process.env.NEGOTIATION_STATE_TABLE_NAME!;

export const handler = async (event: OptimizationInput): Promise<BatchMetrics> => {
  const { campaignBatchId } = event;

  // Query Customer_Record using campaignBatchId-index GSI
  const customersResult = await ddb.send(
    new QueryCommand({
      TableName: CUSTOMER_TABLE,
      IndexName: 'campaignBatchId-index',
      KeyConditionExpression: 'campaignBatchId = :batchId',
      ExpressionAttributeValues: { ':batchId': campaignBatchId },
    }),
  );

  const customers = customersResult.Items ?? [];
  const totalCalls = customers.length;

  if (totalCalls === 0) {
    return {
      campaignBatchId,
      totalCalls: 0,
      resolutionRate: 0,
      averageCallDurationSeconds: 0,
      escalationRate: 0,
      discountUtilization: 0,
      outcomeBreakdown: {},
    };
  }

  // For each customer, fetch their Negotiation_State by contactId
  // contactId is stored in Customer_Record as lastContactId or we derive from lastContactDate
  const negotiationStates: Record<string, unknown>[] = [];
  for (const customer of customers) {
    const contactId = customer['lastContactId'] as string | undefined;
    if (!contactId) continue;

    const stateResult = await ddb.send(
      new GetCommand({
        TableName: NEGOTIATION_TABLE,
        Key: { contactId },
      }),
    );
    if (stateResult.Item) {
      negotiationStates.push(stateResult.Item);
    }
  }

  // Compute metrics
  let resolved = 0;
  let escalated = 0;
  let discountApplied = 0;
  let totalDurationSeconds = 0;
  const outcomeBreakdown: Record<string, number> = {};

  for (const state of negotiationStates) {
    const outcome = (state['outcome'] as string) ?? 'unknown';
    outcomeBreakdown[outcome] = (outcomeBreakdown[outcome] ?? 0) + 1;

    if (outcome === 'resolved') resolved++;
    if (outcome === 'escalated') escalated++;

    // Duration: endedAt - startedAt
    const startedAt = state['startedAt'] as string | undefined;
    const endedAt = state['endedAt'] as string | undefined;
    if (startedAt && endedAt) {
      const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
      totalDurationSeconds += Math.max(0, durationMs / 1000);
    }

    // Discount utilization: check if any offer had a discount applied
    const offersPresented = (state['offersPresented'] as Array<Record<string, unknown>>) ?? [];
    if (offersPresented.some((o) => o['discountApplied'] === true)) {
      discountApplied++;
    }
  }

  const callsWithState = negotiationStates.length;
  const resolutionRate = callsWithState > 0 ? resolved / callsWithState : 0;
  const escalationRate = callsWithState > 0 ? escalated / callsWithState : 0;
  const discountUtilization = callsWithState > 0 ? discountApplied / callsWithState : 0;
  const averageCallDurationSeconds =
    callsWithState > 0 ? totalDurationSeconds / callsWithState : 0;

  return {
    campaignBatchId,
    totalCalls,
    resolutionRate,
    averageCallDurationSeconds,
    escalationRate,
    discountUtilization,
    outcomeBreakdown,
  };
};
