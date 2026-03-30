import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ScheduleCallbackInput, ScheduleCallbackOutput } from '../../../lib/types.js';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CUSTOMER_RECORD_TABLE_NAME!;

export const handler = async (event: ScheduleCallbackInput): Promise<ScheduleCallbackOutput> => {
  const { customerId, preferredTime, contactId } = event;

  const callbackId = randomUUID();
  const scheduledTime = preferredTime;
  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { customerId },
      UpdateExpression:
        'SET lastContactDate = :now, scheduledCallback = :callback, updatedAt = :now',
      ExpressionAttributeValues: {
        ':now': now,
        ':callback': {
          callbackId,
          scheduledTime,
          contactId,
          createdAt: now,
        },
      },
    }),
  );

  return { callbackId, scheduledTime };
};
