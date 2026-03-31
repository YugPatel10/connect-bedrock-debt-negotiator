import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  StrategyGeneratorEvent,
  StrategyTemplate,
  StrategyGeneratorResponse,
} from '../../lib/types.js';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const bedrockClient = new BedrockRuntimeClient({});

const CUSTOMER_TABLE = process.env.CUSTOMER_RECORD_TABLE_NAME!;
const NEGOTIATION_TABLE = process.env.NEGOTIATION_STATE_TABLE_NAME!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-haiku-20240307-v1:0';

// TTL = 7 years from now in epoch seconds
const SEVEN_YEARS_SECONDS = 7 * 365 * 24 * 60 * 60;

/**
 * Default fallback strategy template used when Bedrock call times out or fails.
 * Requirements: 2.4
 */
const DEFAULT_STRATEGY_TEMPLATE: StrategyTemplate = {
  recommendedTone: 'professional',
  openingOfferRange: { minPercent: 0, maxPercent: 10 },
  discountAuthorityLimit: 5,
  escalationThresholds: {
    maxTurns: 10,
    sentimentTrigger: 'sustained_negative',
    sentimentDurationSeconds: 30,
  },
  suggestedPaymentPlans: [],
};

/**
 * Invokes Bedrock with a 3-second timeout using Promise.race().
 * Falls back to DEFAULT_STRATEGY_TEMPLATE on timeout or error.
 * Requirements: 2.2, 2.3, 2.4
 */
async function generateStrategyWithBedrock(customerProfile: Record<string, unknown>): Promise<{
  template: StrategyTemplate;
  source: 'bedrock' | 'default_fallback';
}> {
  const prompt = `You are a debt collection strategy expert. Given the following customer profile, generate a personalized negotiation strategy.

Customer Profile:
${JSON.stringify(customerProfile, null, 2)}

Respond with a JSON object matching this exact schema:
{
  "recommendedTone": "empathetic" | "professional" | "assertive",
  "openingOfferRange": { "minPercent": number, "maxPercent": number },
  "discountAuthorityLimit": number,
  "escalationThresholds": {
    "maxTurns": number,
    "sentimentTrigger": "sustained_negative",
    "sentimentDurationSeconds": number
  },
  "suggestedPaymentPlans": []
}

Return only the JSON object, no additional text.`;

  const bedrockPayload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  };

  const bedrockPromise = bedrockClient.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(bedrockPayload),
    }),
  );

  // Enforce 3-second timeout per requirement 2.3
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Bedrock call exceeded 3-second timeout')), 3000),
  );

  const response = await Promise.race([bedrockPromise, timeoutPromise]);

  // Parse Bedrock response
  const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as {
    content: Array<{ text: string }>;
  };
  const rawText = responseBody.content[0]?.text ?? '{}';

  // Extract JSON from response text
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No valid JSON found in Bedrock response');
  }

  const template = JSON.parse(jsonMatch[0]) as StrategyTemplate;

  // Validate required fields
  if (
    !template.recommendedTone ||
    !template.openingOfferRange ||
    typeof template.discountAuthorityLimit !== 'number' ||
    !template.escalationThresholds
  ) {
    throw new Error('Bedrock response missing required StrategyTemplate fields');
  }

  return { template, source: 'bedrock' };
}

/**
 * Strategy_Generator Lambda handler.
 *
 * 1. Reads Customer_Record from DynamoDB
 * 2. Invokes Bedrock with 3s timeout to generate StrategyTemplate
 * 3. Falls back to DEFAULT_STRATEGY_TEMPLATE on timeout/error
 * 4. Writes StrategyTemplate to Negotiation_State keyed by contactId with 7-year TTL
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
export const handler = async (event: StrategyGeneratorEvent): Promise<StrategyGeneratorResponse> => {
  const { contactId, customerId } = event;

  // Step 1: Read Customer_Record (Req 2.1)
  const customerResult = await ddb.send(
    new GetCommand({
      TableName: CUSTOMER_TABLE,
      Key: { customerId },
    }),
  );

  if (!customerResult.Item) {
    console.warn(`Customer record not found for customerId: ${customerId}. Using default strategy.`);
  }

  const customerProfile = customerResult.Item
    ? {
        balance: customerResult.Item['currentBalance'],
        paymentHistory: customerResult.Item['paymentHistory'] ?? [],
        interactionSummaries: customerResult.Item['interactionSummaries'] ?? [],
        accountValueScore: customerResult.Item['accountValueScore'] ?? 50,
        daysPastDue: customerResult.Item['daysPastDue'] ?? 0,
        accountStatus: customerResult.Item['accountStatus'] ?? 'unknown',
      }
    : {};

  // Step 2 & 3: Invoke Bedrock with 3s timeout, fall back on failure (Req 2.2, 2.3, 2.4)
  let template: StrategyTemplate;
  let source: 'bedrock' | 'default_fallback';

  try {
    const result = await generateStrategyWithBedrock(customerProfile);
    template = result.template;
    source = result.source;
  } catch (err) {
    console.error('Strategy generation failed, using default template:', err);
    template = DEFAULT_STRATEGY_TEMPLATE;
    source = 'default_fallback';
  }

  const generatedAt = new Date().toISOString();
  const strategyId = `${contactId}-${Date.now()}`;
  const ttl = Math.floor(Date.now() / 1000) + SEVEN_YEARS_SECONDS;

  // Step 4: Write StrategyTemplate to Negotiation_State (Req 2.5)
  await ddb.send(
    new PutCommand({
      TableName: NEGOTIATION_TABLE,
      Item: {
        contactId,
        customerId,
        strategyTemplate: template,
        strategyId,
        generatedAt,
        source,
        currentPhase: 'greeting',
        turnCount: 0,
        startedAt: generatedAt,
        ttl,
      },
    }),
  );

  return {
    strategyId,
    contactId,
    template,
    generatedAt,
    source,
  };
};
