import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { EscalateToHumanInput, EscalateToHumanOutput } from '../../../lib/types.js';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.NEGOTIATION_STATE_TABLE_NAME!;

// Default queue ID — in production this would come from Connect or config
const DEFAULT_QUEUE_ID = process.env.HUMAN_AGENT_QUEUE_ID ?? 'default-human-queue';

export const handler = async (event: EscalateToHumanInput): Promise<EscalateToHumanOutput> => {
  const { contactId } = event;

  // Read full Negotiation_State to prepare context for human agent
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { contactId },
    }),
  );

  if (!result.Item) {
    throw new Error(`Negotiation state not found for contactId: ${contactId}`);
  }

  // The actual call transfer is handled by the Contact Flow.
  // This Lambda prepares the context and returns queue routing info.
  const estimatedWaitMinutes = 5; // placeholder; real impl would query Connect metrics

  return {
    queueId: DEFAULT_QUEUE_ID,
    estimatedWaitMinutes,
  };
};
