/**
 * summarize-patterns Lambda
 *
 * Input: BatchMetrics (from AggregateOutcomes step)
 * Lists S3 transcripts for the batch, reads up to 10, invokes Bedrock to produce
 * a pattern summary, writes result to strategy-logs bucket.
 *
 * Requirements: 8.2
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BatchMetrics } from '../../../lib/types.js';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

const TRANSCRIPTS_BUCKET = process.env.TRANSCRIPTS_BUCKET_NAME!;
const STRATEGY_LOGS_BUCKET = process.env.STRATEGY_LOGS_BUCKET_NAME!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-haiku-20240307-v1:0';
const MAX_TRANSCRIPTS = 10;

export interface SummarizePatternsOutput {
  campaignBatchId: string;
  patternSummary: string;
  updatedAt: string;
}

export const handler = async (event: BatchMetrics): Promise<SummarizePatternsOutput> => {
  const { campaignBatchId } = event;

  // List transcript objects under transcripts/{contactId}/transcript.json
  const listResult = await s3.send(
    new ListObjectsV2Command({
      Bucket: TRANSCRIPTS_BUCKET,
      MaxKeys: MAX_TRANSCRIPTS,
    }),
  );

  const transcriptKeys = (listResult.Contents ?? [])
    .filter((obj) => obj.Key?.endsWith('/transcript.json'))
    .slice(0, MAX_TRANSCRIPTS)
    .map((obj) => obj.Key!);

  // Read transcript content
  const transcripts: string[] = [];
  for (const key of transcriptKeys) {
    try {
      const getResult = await s3.send(
        new GetObjectCommand({ Bucket: TRANSCRIPTS_BUCKET, Key: key }),
      );
      const body = await getResult.Body?.transformToString();
      if (body) transcripts.push(body);
    } catch (err) {
      console.warn(`Failed to read transcript ${key}:`, err);
    }
  }

  // Build Bedrock prompt
  const metricsJson = JSON.stringify(event, null, 2);
  const transcriptsText = transcripts.length > 0
    ? transcripts.map((t, i) => `--- Transcript ${i + 1} ---\n${t}`).join('\n\n')
    : 'No transcripts available.';

  const prompt = `You are a debt collection strategy analyst. Analyze the following campaign batch metrics and call transcripts to identify patterns in successful and unsuccessful negotiations.

Campaign Batch Metrics:
${metricsJson}

Call Transcripts (up to ${MAX_TRANSCRIPTS}):
${transcriptsText}

Provide a concise pattern summary (2-3 paragraphs) covering:
1. What approaches led to successful resolutions
2. Common objections and how they were handled
3. Recommendations for improving future campaign strategies

Return only the pattern summary text.`;

  const bedrockPayload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
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
  const patternSummary = responseBody.content[0]?.text ?? 'No summary generated.';

  const updatedAt = new Date().toISOString();

  // Write pattern summary to strategy-logs bucket
  const summaryKey = `strategy-logs/metrics/${campaignBatchId}/pattern-summary.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: STRATEGY_LOGS_BUCKET,
      Key: summaryKey,
      Body: JSON.stringify({ campaignBatchId, patternSummary, updatedAt }),
      ContentType: 'application/json',
    }),
  );

  return { campaignBatchId, patternSummary, updatedAt };
};
