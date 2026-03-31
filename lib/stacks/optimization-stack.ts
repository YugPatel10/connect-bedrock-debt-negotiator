import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as path from 'path';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config';
import { DataStack } from './data-stack';

export interface OptimizationStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
  dataStack: DataStack;
}

/**
 * OptimizationStack — post-call learning loop.
 *
 * Provisions:
 *  - aggregate-outcomes Lambda
 *  - summarize-patterns Lambda
 *  - update-strategy-templates Lambda
 *  - store-metrics Lambda
 *  - Step Functions state machine: AggregateOutcomes → SummarizePatterns →
 *    UpdateStrategyTemplates → StoreMetrics, with retry (max 3) and
 *    MarkFailed → AlertOperations on exhaustion
 *  - Bedrock invocation IAM permissions
 *
 * Requirements: 8.5, 8.6, 9.6
 */
export class OptimizationStack extends cdk.Stack {
  public readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: OptimizationStackProps) {
    super(scope, id, props);

    const { config, dataStack } = props;
    const envName = config.envName;

    // Apply resource tags
    Object.entries(props.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    const lambdaDir = path.join(__dirname, '../../lambdas/optimization');

    // -------------------------------------------------------------------------
    // Shared retry config for all LambdaInvoke states (Req 8.6)
    // -------------------------------------------------------------------------
    const retryProps: sfn.RetryProps = {
      maxAttempts: 3,
      backoffRate: 2,
      interval: cdk.Duration.seconds(5),
      errors: ['States.ALL'],
    };

    // -------------------------------------------------------------------------
    // 9.2 aggregate-outcomes Lambda — Requirements: 8.1
    // -------------------------------------------------------------------------
    const aggregateOutcomesFn = new lambdaNodejs.NodejsFunction(
      this,
      'AggregateOutcomesFn',
      {
        functionName: `aggregate-outcomes-${envName}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(lambdaDir, 'aggregate-outcomes/index.ts'),
        handler: 'handler',
        timeout: cdk.Duration.seconds(60),
        environment: {
          CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
          NEGOTIATION_STATE_TABLE_NAME: dataStack.negotiationStateTableName,
        },
        bundling: { externalModules: [] },
      },
    );
    // Least-privilege: Query on Customer_Record (campaignBatchId-index GSI) + GetItem on Negotiation_State
    aggregateOutcomesFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query'],
        resources: [
          `${dataStack.customerRecordTableArn}/index/campaignBatchId-index`,
        ],
      }),
    );
    aggregateOutcomesFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [dataStack.negotiationStateTableArn],
      }),
    );

    // -------------------------------------------------------------------------
    // 9.3 summarize-patterns Lambda — Requirements: 8.2
    // -------------------------------------------------------------------------
    const summarizePatternsFn = new lambdaNodejs.NodejsFunction(
      this,
      'SummarizePatternsFn',
      {
        functionName: `summarize-patterns-${envName}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(lambdaDir, 'summarize-patterns/index.ts'),
        handler: 'handler',
        timeout: cdk.Duration.seconds(120),
        environment: {
          TRANSCRIPTS_BUCKET_NAME: dataStack.transcriptsBucketName,
          STRATEGY_LOGS_BUCKET_NAME: dataStack.strategyLogsBucketName,
          BEDROCK_MODEL_ID: config.bedrock.optimizationModelId,
        },
        bundling: { externalModules: [] },
      },
    );
    dataStack.transcriptsBucket.grantRead(summarizePatternsFn);
    dataStack.strategyLogsBucket.grantPut(summarizePatternsFn);
    summarizePatternsFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/${config.bedrock.optimizationModelId}`,
        ],
      }),
    );

    // -------------------------------------------------------------------------
    // 9.4 update-strategy-templates Lambda — Requirements: 8.3
    // -------------------------------------------------------------------------
    const updateStrategyTemplatesFn = new lambdaNodejs.NodejsFunction(
      this,
      'UpdateStrategyTemplatesFn',
      {
        functionName: `update-strategy-templates-${envName}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(lambdaDir, 'update-strategy-templates/index.ts'),
        handler: 'handler',
        timeout: cdk.Duration.seconds(60),
        environment: {
          STRATEGY_LOGS_BUCKET_NAME: dataStack.strategyLogsBucketName,
          BEDROCK_MODEL_ID: config.bedrock.optimizationModelId,
        },
        bundling: { externalModules: [] },
      },
    );
    dataStack.strategyLogsBucket.grantPut(updateStrategyTemplatesFn);
    updateStrategyTemplatesFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/${config.bedrock.optimizationModelId}`,
        ],
      }),
    );

    // -------------------------------------------------------------------------
    // 9.5 store-metrics Lambda — Requirements: 8.4
    // -------------------------------------------------------------------------
    const storeMetricsFn = new lambdaNodejs.NodejsFunction(
      this,
      'StoreMetricsFn',
      {
        functionName: `store-metrics-${envName}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(lambdaDir, 'store-metrics/index.ts'),
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        environment: {
          STRATEGY_LOGS_BUCKET_NAME: dataStack.strategyLogsBucketName,
        },
        bundling: { externalModules: [] },
      },
    );
    dataStack.strategyLogsBucket.grantPut(storeMetricsFn);

    // -------------------------------------------------------------------------
    // 9.6 Step Functions state machine — Requirements: 8.5, 8.6
    // -------------------------------------------------------------------------

    // MarkFailed → AlertOperations (Pass states, placeholder for SNS alert)
    const alertOperations = new sfn.Pass(this, 'AlertOperations', {
      comment: 'Placeholder for SNS alert to operations team',
      parameters: {
        'message': 'Optimization workflow failed — operations team alerted',
        'input.$': '$',
      },
    });

    const markFailed = new sfn.Pass(this, 'MarkFailed', {
      comment: 'Mark optimization run as failed',
      parameters: {
        'status': 'FAILED',
        'failedAt.$': '$$.State.EnteredTime',
        'error.$': '$.Error',
        'cause.$': '$.Cause',
      },
    });
    markFailed.next(alertOperations);

    // -------------------------------------------------------------------------
    // State machine chain:
    //
    // AggregateOutcomes (input: OptimizationInput → output: BatchMetrics)
    //   → SummarizePatterns (input: BatchMetrics → output: { campaignBatchId, patternSummary, updatedAt })
    //   → UpdateStrategyTemplates (input: above → output: { templateId, updatedAt })
    //   → PrepareStoreMetricsInput (merges context → { batchMetrics, templateId, patternSummary, updatedAt })
    //   → StoreMetrics (input: above → output: { stored: true })
    //
    // Each state stores its output in resultPath so downstream states can access
    // prior outputs via the accumulated context object.
    // -------------------------------------------------------------------------

    // AggregateOutcomes: write BatchMetrics into $.batchMetrics
    const aggregateOutcomesState = new tasks.LambdaInvoke(this, 'AggregateOutcomes', {
      lambdaFunction: aggregateOutcomesFn,
      resultPath: '$.batchMetrics',
      resultSelector: { 'Payload.$': '$.Payload' },
      comment: 'Aggregate call outcomes from Customer_Record and Negotiation_State',
    });
    aggregateOutcomesState.addRetry(retryProps);
    aggregateOutcomesState.addCatch(markFailed, { errors: ['States.ALL'], resultPath: '$' });

    // SummarizePatterns: input is $.batchMetrics.Payload (the BatchMetrics object)
    // write result into $.summaryResult
    const summarizePatternsState = new tasks.LambdaInvoke(this, 'SummarizePatterns', {
      lambdaFunction: summarizePatternsFn,
      inputPath: '$.batchMetrics.Payload',
      resultPath: '$.summaryResult',
      resultSelector: { 'Payload.$': '$.Payload' },
      comment: 'Invoke Bedrock to summarize patterns from batch transcripts',
    });
    summarizePatternsState.addRetry(retryProps);
    summarizePatternsState.addCatch(markFailed, { errors: ['States.ALL'], resultPath: '$' });
    aggregateOutcomesState.next(summarizePatternsState);

    // UpdateStrategyTemplates: input is $.summaryResult.Payload
    // write result into $.templateResult
    const updateStrategyTemplatesState = new tasks.LambdaInvoke(
      this,
      'UpdateStrategyTemplates',
      {
        lambdaFunction: updateStrategyTemplatesFn,
        inputPath: '$.summaryResult.Payload',
        resultPath: '$.templateResult',
        resultSelector: { 'Payload.$': '$.Payload' },
        comment: 'Generate refined StrategyTemplate via Bedrock and write to S3',
      },
    );
    updateStrategyTemplatesState.addRetry(retryProps);
    updateStrategyTemplatesState.addCatch(markFailed, { errors: ['States.ALL'], resultPath: '$' });
    summarizePatternsState.next(updateStrategyTemplatesState);

    // PrepareStoreMetricsInput: reshape accumulated context for StoreMetrics
    const prepareStoreMetricsInput = new sfn.Pass(this, 'PrepareStoreMetricsInput', {
      comment: 'Merge batchMetrics, patternSummary, and templateId for StoreMetrics',
      parameters: {
        'batchMetrics.$': '$.batchMetrics.Payload',
        'templateId.$': '$.templateResult.Payload.templateId',
        'patternSummary.$': '$.summaryResult.Payload.patternSummary',
        'updatedAt.$': '$.templateResult.Payload.updatedAt',
      },
    });
    updateStrategyTemplatesState.next(prepareStoreMetricsInput);

    // StoreMetrics state
    const storeMetricsState = new tasks.LambdaInvoke(this, 'StoreMetrics', {
      lambdaFunction: storeMetricsFn,
      outputPath: '$.Payload',
      comment: 'Store aggregated metrics and strategy update history in S3',
    });
    storeMetricsState.addRetry(retryProps);
    storeMetricsState.addCatch(markFailed, { errors: ['States.ALL'], resultPath: '$' });
    prepareStoreMetricsInput.next(storeMetricsState);

    // State machine definition
    const stateMachine = new sfn.StateMachine(this, 'OptimizationStateMachine', {
      stateMachineName: `DebtNegotiatorOptimization-${envName}`,
      definitionBody: sfn.DefinitionBody.fromChainable(aggregateOutcomesState),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
    });

    this.stateMachineArn = stateMachine.stateMachineArn;

    // -------------------------------------------------------------------------
    // CloudFormation outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: this.stateMachineArn,
      description: 'Optimization Step Functions state machine ARN',
    });
    new cdk.CfnOutput(this, 'AggregateOutcomesFnArn', {
      value: aggregateOutcomesFn.functionArn,
    });
    new cdk.CfnOutput(this, 'SummarizePatternsFnArn', {
      value: summarizePatternsFn.functionArn,
    });
    new cdk.CfnOutput(this, 'UpdateStrategyTemplatesFnArn', {
      value: updateStrategyTemplatesFn.functionArn,
    });
    new cdk.CfnOutput(this, 'StoreMetricsFnArn', {
      value: storeMetricsFn.functionArn,
    });
  }
}
