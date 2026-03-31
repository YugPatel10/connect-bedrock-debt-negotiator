/**
 * sentiment-writer Lambda
 *
 * Triggered by Contact Lens real-time sentiment events (via EventBridge or
 * Connect event stream). Appends a SentimentEvent to Negotiation_State.sentimentEvents
 * using DynamoDB list_append and updates consecutiveNegativeSeconds tracking.
 *
 * Requirements: 6.1, 6.5
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { SentimentEvent } from '../../lib/types.js';

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.NEGOTIATION_STATE_TABLE_NAME!;

export const handler = async (event: SentimentEvent): Promise<void> => {
  const {
    contactId,
    timestamp,
    sentiment,
    sentimentScore,
    consecutiveNegativeSeconds,
  } = event;

  const sentimentItem = marshall({
    timestamp,
    sentiment,
    sentimentScore,
    consecutiveNegativeSeconds,
  });

  await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ contactId }),
      UpdateExpression:
        'SET sentimentEvents = list_append(if_not_exists(sentimentEvents, :empty), :newEvent), ' +
        'consecutiveNegativeSeconds = :cns',
      ExpressionAttributeValues: {
        ':empty': { L: [] },
        ':newEvent': { L: [{ M: sentimentItem }] },
        ':cns': { N: String(consecutiveNegativeSeconds) },
      },
    }),
  );
};
