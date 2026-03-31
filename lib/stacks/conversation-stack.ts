import * as cdk from 'aws-cdk-lib';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config';
import { ConnectStack } from './connect-stack';
import { AgentStack } from './agent-stack';
import { DataStack } from './data-stack';

export interface ConversationStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
  connectStack: ConnectStack;
  agentStack: AgentStack;
  dataStack: DataStack;
  /** Optional: Step Functions state machine ARN from OptimizationStack (Task 9). */
  optimizationStateMachineArn?: string;
}

/**
 * ConversationStack — call flow and real-time processing.
 *
 * Provisions:
 *  - Contact Flow (5-phase orchestration)          [Task 8.2]
 *  - Sentiment event writer Lambda                 [Task 8.3]
 *  - Post-call Lambda                              [Task 8.4]
 *  - EventBridge rule for CallCompleted events     [Task 8.5]
 *
 * Requirements: 9.5, 4.3–4.5, 6.1–6.5, 7.1–7.4
 */
export class ConversationStack extends cdk.Stack {
  public readonly contactFlowId: string;
  public readonly eventBridgeRuleArn: string;

  constructor(scope: Construct, id: string, props: ConversationStackProps) {
    super(scope, id, props);

    const { config, connectStack, agentStack, dataStack } = props;
    const envName = config.envName;

    // Apply resource tags
    Object.entries(props.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    const lambdaDir = path.join(__dirname, '../../lambdas');

    // -------------------------------------------------------------------------
    // 8.3 Sentiment Writer Lambda
    // Requirements: 6.1, 6.5
    // -------------------------------------------------------------------------
    const sentimentWriterFn = new lambdaNodejs.NodejsFunction(
      this,
      'SentimentWriterFn',
      {
        functionName: `sentiment-writer-${envName}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(lambdaDir, 'sentiment-writer/index.ts'),
        handler: 'handler',
        environment: {
          NEGOTIATION_STATE_TABLE_NAME: dataStack.negotiationStateTableName,
        },
        bundling: { externalModules: [] },
      },
    );
    dataStack.negotiationStateTable.grant(
      sentimentWriterFn,
      'dynamodb:UpdateItem',
    );

    // -------------------------------------------------------------------------
    // 8.4 Post-Call Lambda
    // Requirements: 7.2, 7.3, 7.4
    // -------------------------------------------------------------------------
    const postCallFn = new lambdaNodejs.NodejsFunction(this, 'PostCallFn', {
      functionName: `post-call-${envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'post-call/index.ts'),
      handler: 'handler',
      environment: {
        CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
        NEGOTIATION_STATE_TABLE_NAME: dataStack.negotiationStateTableName,
        RECORDINGS_BUCKET_NAME: dataStack.recordingsBucketName,
        TRANSCRIPTS_BUCKET_NAME: dataStack.transcriptsBucketName,
      },
      bundling: { externalModules: [] },
    });

    // DynamoDB permissions
    dataStack.customerRecordTable.grant(postCallFn, 'dynamodb:UpdateItem');
    dataStack.negotiationStateTable.grant(postCallFn, 'dynamodb:UpdateItem');

    // S3 permissions for recording/transcript references
    dataStack.recordingsBucket.grantPut(postCallFn);
    dataStack.transcriptsBucket.grantPut(postCallFn);

    // EventBridge PutEvents permission
    postCallFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [
          `arn:aws:events:${this.region}:${this.account}:event-bus/default`,
        ],
      }),
    );

    // Allow Connect to invoke the post-call Lambda
    postCallFn.addPermission('ConnectInvokePostCall', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: connectStack.connectInstanceArn,
    });

    // Allow Connect to invoke the strategy generator Lambda
    agentStack.strategyGeneratorFunctionArn; // reference to ensure dependency
    const strategyGeneratorFn = lambda.Function.fromFunctionArn(
      this,
      'StrategyGeneratorFnRef',
      agentStack.strategyGeneratorFunctionArn,
    );
    strategyGeneratorFn.addPermission('ConnectInvokeStrategyGenerator', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: connectStack.connectInstanceArn,
    });

    // -------------------------------------------------------------------------
    // 8.2 Contact Flow — 5-phase orchestration
    // Requirements: 4.3, 4.4, 4.5, 6.2, 6.3, 6.4, 7.1
    // -------------------------------------------------------------------------
    const contactFlowContent = buildContactFlowContent({
      strategyGeneratorArn: agentStack.strategyGeneratorFunctionArn,
      postCallArn: postCallFn.functionArn,
      lexBotId: agentStack.lexBotId,
      lexBotAliasId: agentStack.lexBotAliasId,
      bedrockAgentId: agentStack.bedrockAgentId,
      bedrockAgentAliasId: agentStack.bedrockAgentAliasId,
    });

    const contactFlow = new connect.CfnContactFlow(this, 'DebtNegotiatorFlow', {
      instanceArn: connectStack.connectInstanceArn,
      name: `DebtNegotiatorFlow-${envName}`,
      type: 'CONTACT_FLOW',
      description:
        'Autonomous debt negotiation contact flow — 5-phase orchestration',
      content: JSON.stringify(contactFlowContent),
    });

    this.contactFlowId = contactFlow.attrContactFlowArn;

    // -------------------------------------------------------------------------
    // 8.5 EventBridge Rule — CallCompleted → OptimizationStack state machine
    // Requirements: 7.4, 8.1
    // -------------------------------------------------------------------------
    const targetArn =
      props.optimizationStateMachineArn ??
      `arn:aws:states:${this.region}:${this.account}:stateMachine:DebtNegotiatorOptimization-${envName}`;

    const sfnRole = new iam.Role(this, 'EventBridgeSfnRole', {
      roleName: `debt-negotiator-eb-sfn-${envName}`,
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
      description: 'Allows EventBridge to start the optimization state machine',
    });
    sfnRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['states:StartExecution'],
        resources: [targetArn],
      }),
    );

    const rule = new events.CfnRule(this, 'CallCompletedRule', {
      name: `debt-negotiator-call-completed-${envName}`,
      description: 'Routes CallCompleted events to the optimization state machine',
      eventBusName: 'default',
      eventPattern: {
        source: ['autonomous-debt-negotiator'],
        'detail-type': ['CallCompleted'],
      },
      state: 'ENABLED',
      targets: [
        {
          id: 'OptimizationStateMachine',
          arn: targetArn,
          roleArn: sfnRole.roleArn,
        },
      ],
    });

    this.eventBridgeRuleArn = rule.attrArn;

    // -------------------------------------------------------------------------
    // CloudFormation outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ContactFlowArn', {
      value: this.contactFlowId,
      description: 'Debt Negotiator Contact Flow ARN',
    });
    new cdk.CfnOutput(this, 'EventBridgeRuleArn', {
      value: this.eventBridgeRuleArn,
      description: 'EventBridge rule ARN for CallCompleted events',
    });
    new cdk.CfnOutput(this, 'SentimentWriterFnArn', {
      value: sentimentWriterFn.functionArn,
    });
    new cdk.CfnOutput(this, 'PostCallFnArn', {
      value: postCallFn.functionArn,
    });
  }
}

// ---------------------------------------------------------------------------
// Contact Flow content builder
// ---------------------------------------------------------------------------

interface ContactFlowParams {
  strategyGeneratorArn: string;
  postCallArn: string;
  lexBotId: string;
  lexBotAliasId: string;
  bedrockAgentId: string;
  bedrockAgentAliasId: string;
}

/**
 * Builds the Amazon Connect contact flow JSON for the 5-phase debt negotiation flow.
 *
 * Phase 1: Invoke Strategy_Generator Lambda
 * Phase 2: Start Lex V2 bot conversation (greeting + intent detection)
 * Phase 3: Branch on Lex intent:
 *   - willing_to_discuss → Invoke Bedrock Agent
 *   - request_callback   → Invoke schedule_callback Lambda → Disconnect
 *   - dispute            → Transfer to queue (escalate to human)
 *   - hang_up / default  → Disconnect
 * Phase 4: After Bedrock Agent, check sentiment (Contact Lens enabled on instance)
 * Phase 5: On disconnect → Invoke post-call Lambda
 */
function buildContactFlowContent(params: ContactFlowParams): object {
  const {
    strategyGeneratorArn,
    postCallArn,
    lexBotId,
    lexBotAliasId,
    bedrockAgentId,
    bedrockAgentAliasId,
  } = params;

  return {
    Version: '2019-10-30',
    StartAction: 'phase1-invoke-strategy',
    Actions: [
      // ------------------------------------------------------------------
      // Phase 1: Invoke Strategy_Generator Lambda
      // ------------------------------------------------------------------
      {
        Identifier: 'phase1-invoke-strategy',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: strategyGeneratorArn,
          InvocationTimeLimitSeconds: '3',
          LambdaInvocationAttributes: {
            contactId: '$.ContactId',
            customerId: '$.Attributes.customerId',
          },
        },
        Transitions: {
          NextAction: 'phase2-lex-greeting',
          Errors: [
            {
              NextAction: 'phase2-lex-greeting',
              ErrorType: 'NoMatchingError',
            },
          ],
        },
      },

      // ------------------------------------------------------------------
      // Phase 2: Start Lex V2 bot conversation
      // ------------------------------------------------------------------
      {
        Identifier: 'phase2-lex-greeting',
        Type: 'StartBotConversation',
        Parameters: {
          BotAliasArn: `arn:aws:lex:us-east-1::bot-alias/${lexBotId}/${lexBotAliasId}`,
          LocaleId: 'en_US',
          DialogAction: {
            Type: 'ElicitIntent',
          },
          SessionState: {
            SessionAttributes: {
              contactId: '$.ContactId',
            },
          },
        },
        Transitions: {
          NextAction: 'phase3-check-intent',
          Errors: [
            {
              NextAction: 'phase5-disconnect',
              ErrorType: 'NoMatchingError',
            },
          ],
        },
      },

      // ------------------------------------------------------------------
      // Phase 3: Check intent from Lex session attributes
      // ------------------------------------------------------------------
      {
        Identifier: 'phase3-check-intent',
        Type: 'CheckAttribute',
        Parameters: {
          Attribute: 'BotResult.IntentName',
          Namespace: 'System',
          Conditions: [
            {
              Operator: 'Equals',
              Operands: ['WillingToDiscuss'],
              NextAction: 'phase3-bedrock-agent',
            },
            {
              Operator: 'Equals',
              Operands: ['RequestCallback'],
              NextAction: 'phase3-schedule-callback',
            },
            {
              Operator: 'Equals',
              Operands: ['Dispute'],
              NextAction: 'phase3-transfer-queue',
            },
            {
              Operator: 'Equals',
              Operands: ['HangUp'],
              NextAction: 'phase5-disconnect',
            },
          ],
          Default: 'phase5-disconnect',
        },
        Transitions: {
          NextAction: 'phase5-disconnect',
          Conditions: [
            {
              NextAction: 'phase3-bedrock-agent',
              Condition: {
                Operator: 'Equals',
                Operands: ['WillingToDiscuss'],
              },
            },
            {
              NextAction: 'phase3-schedule-callback',
              Condition: {
                Operator: 'Equals',
                Operands: ['RequestCallback'],
              },
            },
            {
              NextAction: 'phase3-transfer-queue',
              Condition: {
                Operator: 'Equals',
                Operands: ['Dispute'],
              },
            },
          ],
        },
      },

      // ------------------------------------------------------------------
      // Phase 3a: Invoke Bedrock Agent (willing_to_discuss)
      // ------------------------------------------------------------------
      {
        Identifier: 'phase3-bedrock-agent',
        Type: 'InvokeBedrockAgent',
        Parameters: {
          AgentId: bedrockAgentId,
          AgentAliasId: bedrockAgentAliasId,
          SessionId: '$.ContactId',
          InputText: '$.InitialContactId',
          SessionState: {
            SessionAttributes: {
              contactId: '$.ContactId',
              customerId: '$.Attributes.customerId',
            },
          },
        },
        Transitions: {
          NextAction: 'phase4-post-agent',
          Errors: [
            {
              NextAction: 'phase3-transfer-queue',
              ErrorType: 'NoMatchingError',
            },
          ],
        },
      },

      // ------------------------------------------------------------------
      // Phase 3b: Schedule callback (request_callback)
      // ------------------------------------------------------------------
      {
        Identifier: 'phase3-schedule-callback',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: strategyGeneratorArn,
          InvocationTimeLimitSeconds: '8',
          LambdaInvocationAttributes: {
            action: 'schedule_callback',
            contactId: '$.ContactId',
            customerId: '$.Attributes.customerId',
          },
        },
        Transitions: {
          NextAction: 'phase5-disconnect',
          Errors: [
            {
              NextAction: 'phase5-disconnect',
              ErrorType: 'NoMatchingError',
            },
          ],
        },
      },

      // ------------------------------------------------------------------
      // Phase 3c: Transfer to queue (dispute → escalate to human)
      // ------------------------------------------------------------------
      {
        Identifier: 'phase3-transfer-queue',
        Type: 'TransferContactToQueue',
        Parameters: {
          QueueId: 'arn:aws:connect:us-east-1:855676085285:instance/PLACEHOLDER/queue/PLACEHOLDER',
        },
        Transitions: {
          NextAction: 'phase5-disconnect',
          Errors: [
            {
              NextAction: 'phase5-disconnect',
              ErrorType: 'NoMatchingError',
            },
          ],
        },
      },

      // ------------------------------------------------------------------
      // Phase 4: Post-agent sentiment check (Contact Lens enabled on instance)
      // ------------------------------------------------------------------
      {
        Identifier: 'phase4-post-agent',
        Type: 'CheckAttribute',
        Parameters: {
          Attribute: 'ContactLens.SentimentLabel',
          Namespace: 'System',
          Conditions: [
            {
              Operator: 'Equals',
              Operands: ['NEGATIVE'],
              NextAction: 'phase5-invoke-post-call',
            },
            {
              Operator: 'Equals',
              Operands: ['POSITIVE'],
              NextAction: 'phase5-invoke-post-call',
            },
          ],
          Default: 'phase5-invoke-post-call',
        },
        Transitions: {
          NextAction: 'phase5-invoke-post-call',
        },
      },

      // ------------------------------------------------------------------
      // Phase 5: Invoke post-call Lambda on disconnect
      // ------------------------------------------------------------------
      {
        Identifier: 'phase5-invoke-post-call',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: postCallArn,
          InvocationTimeLimitSeconds: '8',
          LambdaInvocationAttributes: {
            contactId: '$.ContactId',
            customerId: '$.Attributes.customerId',
            campaignBatchId: '$.Attributes.campaignBatchId',
          },
        },
        Transitions: {
          NextAction: 'phase5-disconnect',
          Errors: [
            {
              NextAction: 'phase5-disconnect',
              ErrorType: 'NoMatchingError',
            },
          ],
        },
      },

      // ------------------------------------------------------------------
      // Disconnect
      // ------------------------------------------------------------------
      {
        Identifier: 'phase5-disconnect',
        Type: 'DisconnectParticipant',
        Parameters: {},
        Transitions: {},
      },
    ],
  };
}
