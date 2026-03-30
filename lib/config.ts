import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

// ---------------------------------------------------------------------------
// CDK context schema
// ---------------------------------------------------------------------------

/**
 * All CDK context keys used by this application.
 * Pass via `cdk deploy -c env=staging` or in cdk.json under "context".
 */
export interface CdkContextSchema {
  /** Deployment environment: dev | staging | prod */
  env: 'dev' | 'staging' | 'prod';
}

// ---------------------------------------------------------------------------
// Per-environment configuration shape
// ---------------------------------------------------------------------------

export interface DialerConfig {
  /** Fraction of dialer bandwidth to allocate (0.0 – 1.0) */
  bandwidthAllocation: number;
  /** Maximum allowed call abandonment rate (e.g. 0.03 = 3%) */
  abandonmentRateThreshold: number;
  /** Maximum concurrent outbound calls */
  maxConcurrentCalls: number;
}

export interface RetryWindowConfig {
  /** Maximum number of retry attempts per customer */
  maxRetries: number;
  /** Minutes between retry attempts */
  retryWindowMinutes: number;
}

export interface BedrockConfig {
  /** Bedrock model ID used for strategy generation */
  strategyModelId: string;
  /** Bedrock model ID used for optimization summarization */
  optimizationModelId: string;
  /** Maximum tokens for strategy generation */
  strategyMaxTokens: number;
  /** Maximum tokens for optimization summarization */
  optimizationMaxTokens: number;
}

export interface EnvironmentConfig {
  /** Environment name */
  envName: 'dev' | 'staging' | 'prod';
  /** DynamoDB billing mode */
  dynamoDbBillingMode: dynamodb.BillingMode;
  /** Provisioned read capacity (only used when billingMode = PROVISIONED) */
  dynamoDbReadCapacity?: number;
  /** Provisioned write capacity (only used when billingMode = PROVISIONED) */
  dynamoDbWriteCapacity?: number;
  /** Bedrock model configuration */
  bedrock: BedrockConfig;
  /** Predictive dialer thresholds */
  dialer: DialerConfig;
  /** Retry window settings */
  retry: RetryWindowConfig;
  /** Strategy generator Lambda timeout in seconds */
  strategyGeneratorTimeoutSeconds: number;
  /** Maximum negotiation turns before offering callback/escalation */
  maxNegotiationTurns: number;
  /** Seconds of sustained negative sentiment before triggering escalation prompt */
  sentimentEscalationSeconds: number;
  /** Interval (seconds) at which sentiment events are written to DynamoDB */
  sentimentWriteIntervalSeconds: number;
}

// ---------------------------------------------------------------------------
// Per-environment defaults
// ---------------------------------------------------------------------------

const DEV_CONFIG: EnvironmentConfig = {
  envName: 'dev',
  dynamoDbBillingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  bedrock: {
    strategyModelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    optimizationModelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    strategyMaxTokens: 1024,
    optimizationMaxTokens: 2048,
  },
  dialer: {
    bandwidthAllocation: 0.5,
    abandonmentRateThreshold: 0.03,
    maxConcurrentCalls: 10,
  },
  retry: {
    maxRetries: 2,
    retryWindowMinutes: 60,
  },
  strategyGeneratorTimeoutSeconds: 3,
  maxNegotiationTurns: 10,
  sentimentEscalationSeconds: 30,
  sentimentWriteIntervalSeconds: 5,
};

const STAGING_CONFIG: EnvironmentConfig = {
  envName: 'staging',
  dynamoDbBillingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  bedrock: {
    strategyModelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
    optimizationModelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
    strategyMaxTokens: 1024,
    optimizationMaxTokens: 4096,
  },
  dialer: {
    bandwidthAllocation: 0.7,
    abandonmentRateThreshold: 0.03,
    maxConcurrentCalls: 50,
  },
  retry: {
    maxRetries: 3,
    retryWindowMinutes: 120,
  },
  strategyGeneratorTimeoutSeconds: 3,
  maxNegotiationTurns: 12,
  sentimentEscalationSeconds: 30,
  sentimentWriteIntervalSeconds: 5,
};

const PROD_CONFIG: EnvironmentConfig = {
  envName: 'prod',
  dynamoDbBillingMode: dynamodb.BillingMode.PROVISIONED,
  dynamoDbReadCapacity: 100,
  dynamoDbWriteCapacity: 50,
  bedrock: {
    strategyModelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
    optimizationModelId: 'anthropic.claude-3-opus-20240229-v1:0',
    strategyMaxTokens: 1024,
    optimizationMaxTokens: 8192,
  },
  dialer: {
    bandwidthAllocation: 0.9,
    abandonmentRateThreshold: 0.03,
    maxConcurrentCalls: 200,
  },
  retry: {
    maxRetries: 3,
    retryWindowMinutes: 240,
  },
  strategyGeneratorTimeoutSeconds: 3,
  maxNegotiationTurns: 15,
  sentimentEscalationSeconds: 30,
  sentimentWriteIntervalSeconds: 5,
};

const ENV_CONFIGS: Record<string, EnvironmentConfig> = {
  dev: DEV_CONFIG,
  staging: STAGING_CONFIG,
  prod: PROD_CONFIG,
};

// ---------------------------------------------------------------------------
// Config helper
// ---------------------------------------------------------------------------

/**
 * Reads the `env` CDK context variable and returns the matching
 * EnvironmentConfig. Defaults to `dev` if the context key is absent.
 *
 * Usage in bin/app.ts:
 *   const config = getEnvironmentConfig(app, app.node.tryGetContext('env') ?? 'dev');
 */
export function getEnvironmentConfig(
  _scope: cdk.App,
  envName: string,
): EnvironmentConfig {
  const config = ENV_CONFIGS[envName];
  if (!config) {
    throw new Error(
      `Unknown environment "${envName}". Valid values: ${Object.keys(ENV_CONFIGS).join(', ')}`,
    );
  }
  return config;
}
