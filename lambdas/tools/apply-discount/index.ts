import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApplyDiscountInput, ApplyDiscountOutput } from '../../../lib/types.js';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const CUSTOMER_TABLE = process.env.CUSTOMER_RECORD_TABLE_NAME!;
const NEGOTIATION_TABLE = process.env.NEGOTIATION_STATE_TABLE_NAME!;

export const handler = async (event: ApplyDiscountInput): Promise<ApplyDiscountOutput> => {
  const { customerId, discountPercent, contactId } = event;

  // Read Negotiation_State to get discountAuthorityLimit
  const stateResult = await ddb.send(
    new GetCommand({
      TableName: NEGOTIATION_TABLE,
      Key: { contactId },
    }),
  );

  if (!stateResult.Item) {
    throw new Error(`Negotiation state not found for contactId: ${contactId}`);
  }

  const strategyTemplate = stateResult.Item['strategyTemplate'] as { discountAuthorityLimit: number };
  const discountAuthorityLimit: number = strategyTemplate?.discountAuthorityLimit ?? 0;

  // Read current balance from Customer_Record
  const customerResult = await ddb.send(
    new GetCommand({
      TableName: CUSTOMER_TABLE,
      Key: { customerId },
    }),
  );

  if (!customerResult.Item) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  const originalBalance: number = customerResult.Item['currentBalance'] as number;

  // Validate discount against authority limit
  if (discountPercent > discountAuthorityLimit) {
    return {
      approved: false,
      reason: 'Exceeds authority limit',
      newBalance: originalBalance,
    };
  }

  // Apply discount
  const discountAmount = Math.round(originalBalance * (discountPercent / 100) * 100) / 100;
  const newBalance = Math.round((originalBalance - discountAmount) * 100) / 100;

  await ddb.send(
    new UpdateCommand({
      TableName: CUSTOMER_TABLE,
      Key: { customerId },
      UpdateExpression: 'SET currentBalance = :newBalance, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':newBalance': newBalance,
        ':updatedAt': new Date().toISOString(),
      },
    }),
  );

  return {
    approved: true,
    newBalance,
  };
};
