import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LookupAccountInput, LookupAccountOutput } from '../../../lib/types.js';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CUSTOMER_RECORD_TABLE_NAME!;

export const handler = async (event: LookupAccountInput): Promise<LookupAccountOutput> => {
  const { customerId } = event;

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { customerId },
    }),
  );

  if (!result.Item) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  const item = result.Item;

  return {
    balance: item['currentBalance'] as number,
    minimumPayment: item['minimumPayment'] as number,
    status: item['accountStatus'] as string,
    daysPastDue: item['daysPastDue'] as number,
  };
};
