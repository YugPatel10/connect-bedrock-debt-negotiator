import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  ConnectCampaignsV2Client,
  PutOutboundRequestBatchCommand,
} from '@aws-sdk/client-connectcampaignsv2';
import { CampaignBatchRequest, DialAttemptResult } from '../../lib/types.js';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const campaignsClient = new ConnectCampaignsV2Client({});

const CUSTOMER_TABLE = process.env.CUSTOMER_RECORD_TABLE_NAME!;
const OUTBOUND_CAMPAIGN_ID = process.env.OUTBOUND_CAMPAIGN_ID!;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES ?? '3', 10);
const RETRY_WINDOW_MINUTES = parseInt(process.env.RETRY_WINDOW_MINUTES ?? '60', 10);

/**
 * Campaign_Manager Lambda
 *
 * Steps:
 *  1. Query Customer_Record by campaignBatchId-index GSI
 *  2. For each customer, call PutOutboundRequestBatchCommand (Connect Campaigns v2)
 *  3. Record disposition in Customer_Record (UpdateItem)
 *  4. Return summary of DialAttemptResults
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */
export const handler = async (event: CampaignBatchRequest): Promise<DialAttemptResult[]> => {
  const { campaignId, retryPolicy } = event;
  const maxRetries = retryPolicy?.maxRetries ?? MAX_RETRIES;
  const retryWindowMinutes = retryPolicy?.retryWindowMinutes ?? RETRY_WINDOW_MINUTES;
  const retryableDispositions = new Set<string>(
    retryPolicy?.retryableDispositions ?? ['no_answer', 'busy', 'voicemail'],
  );

  // -------------------------------------------------------------------------
  // Step 1: Query Customer_Record table using campaignBatchId-index GSI
  // -------------------------------------------------------------------------
  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: CUSTOMER_TABLE,
      IndexName: 'campaignBatchId-index',
      KeyConditionExpression: 'campaignBatchId = :batchId',
      ExpressionAttributeValues: {
        ':batchId': campaignId,
      },
    }),
  );

  const customers = queryResult.Items ?? [];

  if (customers.length === 0) {
    console.log(`No customers found for campaignBatchId: ${campaignId}`);
    return [];
  }

  const now = new Date().toISOString();
  const expirationTime = new Date(Date.now() + retryWindowMinutes * 60 * 1000);
  const results: DialAttemptResult[] = [];

  // -------------------------------------------------------------------------
  // Step 2: For each customer, call PutOutboundRequestBatchCommand (v2)
  // Batch in chunks of 25 (API limit)
  // -------------------------------------------------------------------------
  const BATCH_SIZE = 25;

  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const batch = customers.slice(i, i + BATCH_SIZE);

    const outboundRequests = batch.map((customer) => ({
      clientToken: randomUUID(),
      expirationTime: expirationTime,
      channelSubtypeParameters: {
        telephony: {
          destinationPhoneNumber: (customer['phoneNumber'] as string) ?? '',
          attributes: {
            customerId: customer['customerId'] as string,
            campaignBatchId: campaignId,
          },
        },
      },
    }));

    const response = await campaignsClient.send(
      new PutOutboundRequestBatchCommand({
        id: OUTBOUND_CAMPAIGN_ID,
        outboundRequests,
      }),
    );

    // Map successful/failed requests back to DialAttemptResult
    const successTokens = new Set(
      (response.successfulRequests ?? []).map((r) => r.clientToken),
    );

    for (let j = 0; j < batch.length; j++) {
      const customer = batch[j];
      const customerId = customer['customerId'] as string;
      const clientToken = outboundRequests[j].clientToken;
      const disposition: DialAttemptResult['disposition'] = successTokens.has(clientToken)
        ? 'answered'
        : 'error';

      results.push({
        contactId: clientToken,
        customerId,
        disposition,
        timestamp: now,
        retryCount: (customer['retryCount'] as number) ?? 0,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Record disposition in Customer_Record (UpdateItem)
  //   answered          → update lastContactDate, lastOutcome = 'answered'
  //   no_answer/busy/voicemail → if retryCount < maxRetries, increment retryCount
  //                              and set nextRetryAt; else set lastOutcome = disposition
  // -------------------------------------------------------------------------
  const updates: Promise<void>[] = [];

  for (const result of results) {
    const { customerId, disposition } = result;
    const customer = customers.find((c) => (c['customerId'] as string) === customerId);
    const currentRetryCount = (customer?.['retryCount'] as number) ?? 0;

    if (disposition === 'answered') {
      updates.push(
        ddb
          .send(
            new UpdateCommand({
              TableName: CUSTOMER_TABLE,
              Key: { customerId },
              UpdateExpression:
                'SET lastContactDate = :now, lastOutcome = :outcome, updatedAt = :now',
              ExpressionAttributeValues: {
                ':now': now,
                ':outcome': 'answered',
              },
            }),
          )
          .then(() => undefined),
      );
    } else if (retryableDispositions.has(disposition)) {
      if (currentRetryCount < maxRetries) {
        const nextRetryAt = new Date(Date.now() + retryWindowMinutes * 60 * 1000).toISOString();
        updates.push(
          ddb
            .send(
              new UpdateCommand({
                TableName: CUSTOMER_TABLE,
                Key: { customerId },
                UpdateExpression:
                  'SET retryCount = :retryCount, nextRetryAt = :nextRetryAt, lastOutcome = :outcome, updatedAt = :now',
                ExpressionAttributeValues: {
                  ':retryCount': currentRetryCount + 1,
                  ':nextRetryAt': nextRetryAt,
                  ':outcome': disposition,
                  ':now': now,
                },
              }),
            )
            .then(() => {
              console.log(
                `Scheduled retry ${currentRetryCount + 1}/${maxRetries} for customer ${customerId} (${disposition})`,
              );
            }),
        );
      } else {
        // Max retries reached — record final disposition
        updates.push(
          ddb
            .send(
              new UpdateCommand({
                TableName: CUSTOMER_TABLE,
                Key: { customerId },
                UpdateExpression:
                  'SET lastOutcome = :outcome, updatedAt = :now',
                ExpressionAttributeValues: {
                  ':outcome': disposition,
                  ':now': now,
                },
              }),
            )
            .then(() => {
              console.log(
                `Max retries (${maxRetries}) reached for customer ${customerId}, final disposition: ${disposition}`,
              );
            }),
        );
      }
    }
  }

  await Promise.all(updates);

  // -------------------------------------------------------------------------
  // Step 4: Return summary of DialAttemptResults
  // -------------------------------------------------------------------------
  return results;
};
