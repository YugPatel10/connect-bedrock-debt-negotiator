/**
 * update-strategy-templates Lambda
 *
 * Input: { campaignBatchId, patternSummary, updatedAt }
 * Invokes Bedrock to generate a refined StrategyTemplate based on the pattern summary.
 * Writes the refined template to strategy-logs/templates/{templateId}.json in strategy-logs bucket.
 *
 * Requirements: 8.3
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { StrategyTemplate } from '../../../lib/types.js';
import { SummarizePatternsOutput } from '../summarize-patterns/index.js';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

const STRATEGY_LOGS_BUCKET = process.env.STRATEGY_LOGS_BUCKET_NAME!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-haiku-20240307-v1:0';

export interface UpdateStrategyTemplatesOutput {
  templateId: string;
  updatedAt: string;
}

export const handler = async (event: SummarizePatternsOutput): Promise<UpdateStrategyTemplatesOutput> => {
  const { campaignBatchId, patternSummary, updatedAt } = event;

  const prompt = `You are a debt collection strategy expert. Based on the following pattern summary from a recent campaign batch, generate a refined negotiation strategy template.

Pattern Summary:
${patternSummary}

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
    messages: [{ role: 'user', content: prompt }],
  };

  const bedrockResponse = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(bedrockPayload),
    }),
  );

  const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body)) as {
    content: Array<{ text: string }>;
  };
  const rawText = responseBody.content[0]?.text ?? '{}';

  // Extract JSON from response
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  let refinedTemplate: StrategyTemplate;
  if (jsonMatch) {
    refinedTemplate = JSON.parse(jsonMatch[0]) as StrategyTemplate;
  } else {
    // Fallback default template
    refinedTemplate = {
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
  }

  const templateId = `template-${campaignBatchId}-${Date.now()}`;

  // Write refined template to strategy-logs/templates/{templateId}.json
  const templateKey = `strategy-logs/templates/${templateId}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: STRATEGY_LOGS_BUCKET,
      Key: templateKey,
      Body: JSON.stringify({ templateId, campaignBatchId, template: refinedTemplate, updatedAt }),
      ContentType: 'application/json',
    }),
  );

  return { templateId, updatedAt };
};
