/**
 * post-call Lambda
 *
 * Triggered by Contact Flow disconnect event.
 * Step 1: Update Customer_Record with final outcome.
 * Step 2: Write S3 recording/transcript key references to Negotiation_State.
 * Step 3: Publish PostCallEvent to EventBridge default bus.
 *
 * Requirements: 7.2, 7.3, 7.4
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { PostCallEvent } from '../../lib/types.js';

const dynamo = new DynamoDBClient({});
const eventBridge = new EventBridgeClient({});

const CUSTOMER_RECORD_TABLE = process.env.CUSTOMER_RECORD_TABLE_NAME!;
const NEGOTIATION_STATE_TABLE = process.env.NEGOTIATION_STATE_TABLE_NAME!;

export interface PostCallInput {
  contactId: string;
  customerId: string;
  campaignBatchId: string;
  outcome: string;
  callDurationSeconds: number;
  turnCount: number;
  discountApplied: boolean;
  discountPercent?: number;
  escalated: boolean;
  sentimentSummary: {
    averageSentiment: string;
    negativeSeconds: number;
  };
}

export const handler = async (input: PostCallInput): Promise<void> => {
  const {
    contactId,
    customerId,
    campaignBatchId,
    outcome,
    callDurationSeconds,
    turnCount,
    discountApplied,
    discountPercent,
    escalated,
    sentimentSummary,
  } = input;

  const completedAt = new Date().toISOString();

  // Step 1: Update Customer_Record with final outcome
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CUSTOMER_RECORD_TABLE,
      Key: marshall({ customerId }),
      UpdateExpression:
        'SET lastOutcome = :outcome, lastContactDate = :ts, updatedAt = :ts',
      ExpressionAttributeValues: marshall({
        ':outcome': outcome,
        ':ts': completedAt,
      }),
    }),
  );

  // Step 2: Write S3 key references to Negotiation_State
  const recordingKey = `${contactId}/recording.wav`;
  const transcriptKey = `${contactId}/transcript.json`;

  await dynamo.send(
    new UpdateItemCommand({
      TableName: NEGOTIATION_STATE_TABLE,
      Key: marshall({ contactId }),
      UpdateExpression:
        'SET #outcome = :outcome, endedAt = :ts, recordingKey = :rk, transcriptKey = :tk',
      ExpressionAttributeNames: { '#outcome': 'outcome' },
      ExpressionAttributeValues: marshall({
        ':outcome': outcome,
        ':ts': completedAt,
        ':rk': recordingKey,
        ':tk': transcriptKey,
      }),
    }),
  );

  // Step 3: Publish PostCallEvent to EventBridge default bus
  const postCallEvent: PostCallEvent = {
    source: 'autonomous-debt-negotiator',
    detailType: 'CallCompleted',
    detail: {
      contactId,
      customerId,
      campaignBatchId,
      outcome,
      callDurationSeconds,
      turnCount,
      discountApplied,
      discountPercent,
      escalated,
      sentimentSummary,
      completedAt,
    },
  };

  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: postCallEvent.source,
          DetailType: postCallEvent.detailType,
          Detail: JSON.stringify(postCallEvent.detail),
        },
      ],
    }),
  );
};
