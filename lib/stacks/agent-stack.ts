import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';
import { DataStack } from './data-stack.js';

export interface AgentStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
  dataStack: DataStack;
}

/**
 * AgentStack — AI agent and bot definitions.
 *
 * Provisions:
 *  - Bedrock Agent with Action Group (6 Tool_Action Lambdas)  [Task 5]
 *  - Lex V2 Bot (greeting + intent detection)                 [Task 5]
 *  - Strategy_Generator Lambda                                [Task 5]
 *  - Tool_Action Lambdas: lookup_account, calculate_payment_plan,
 *    apply_discount, schedule_callback, escalate_to_human, send_confirmation
 *
 * Requirements: 9.3, 5.1, 4.1, 4.2, 2.1–2.5
 */
export class AgentStack extends cdk.Stack {
  // Exported references consumed by ConversationStack
  public readonly bedrockAgentId: string = '';
  public readonly bedrockAgentAliasId: string = '';
  public readonly lexBotId: string = '';
  public readonly lexBotAliasId: string = '';
  public readonly strategyGeneratorFunctionArn: string = '';

  // Tool_Action Lambda ARNs (consumed by Bedrock Agent Action Group in Task 5)
  public readonly lookupAccountFn: lambdaNodejs.NodejsFunction;
  public readonly calculatePaymentPlanFn: lambdaNodejs.NodejsFunction;
  public readonly applyDiscountFn: lambdaNodejs.NodejsFunction;
  public readonly scheduleCallbackFn: lambdaNodejs.NodejsFunction;
  public readonly escalateToHumanFn: lambdaNodejs.NodejsFunction;
  public readonly sendConfirmationFn: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const { dataStack } = props;

    // Apply resource tags
    Object.entries(props.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    const lambdaDir = path.join(__dirname, '../../lambdas/tools');

    // -------------------------------------------------------------------------
    // 4.2 lookup_account Lambda
    // Requirements: 5.2, 10.3
    // -------------------------------------------------------------------------
    this.lookupAccountFn = new lambdaNodejs.NodejsFunction(this, 'LookupAccountFn', {
      functionName: `lookup-account-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'lookup-account/index.ts'),
      handler: 'handler',
      environment: {
        CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
      },
      bundling: {
        externalModules: [],
      },
    });

    // Least-privilege: GetItem on CustomerRecord only
    dataStack.customerRecordTable.grant(this.lookupAccountFn, 'dynamodb:GetItem');

    // -------------------------------------------------------------------------
    // 4.3 calculate_payment_plan Lambda (pure computation — no AWS calls)
    // Requirements: 5.3
    // -------------------------------------------------------------------------
    this.calculatePaymentPlanFn = new lambdaNodejs.NodejsFunction(this, 'CalculatePaymentPlanFn', {
      functionName: `calculate-payment-plan-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'calculate-payment-plan/index.ts'),
      handler: 'handler',
      bundling: {
        externalModules: [],
      },
    });

    // -------------------------------------------------------------------------
    // 4.4 apply_discount Lambda
    // Requirements: 5.4, 10.3
    // -------------------------------------------------------------------------
    this.applyDiscountFn = new lambdaNodejs.NodejsFunction(this, 'ApplyDiscountFn', {
      functionName: `apply-discount-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'apply-discount/index.ts'),
      handler: 'handler',
      environment: {
        CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
        NEGOTIATION_STATE_TABLE_NAME: dataStack.negotiationStateTableName,
      },
      bundling: {
        externalModules: [],
      },
    });

    // Least-privilege: GetItem on NegotiationState + GetItem/UpdateItem on CustomerRecord
    dataStack.negotiationStateTable.grant(this.applyDiscountFn, 'dynamodb:GetItem');
    dataStack.customerRecordTable.grant(this.applyDiscountFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    // -------------------------------------------------------------------------
    // 4.6 schedule_callback Lambda
    // Requirements: 4.4, 5.1
    // -------------------------------------------------------------------------
    this.scheduleCallbackFn = new lambdaNodejs.NodejsFunction(this, 'ScheduleCallbackFn', {
      functionName: `schedule-callback-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'schedule-callback/index.ts'),
      handler: 'handler',
      environment: {
        CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
      },
      bundling: {
        externalModules: [],
      },
    });

    // Least-privilege: UpdateItem on CustomerRecord only
    dataStack.customerRecordTable.grant(this.scheduleCallbackFn, 'dynamodb:UpdateItem');

    // -------------------------------------------------------------------------
    // 4.7 escalate_to_human Lambda
    // Requirements: 4.5, 5.6
    // -------------------------------------------------------------------------
    this.escalateToHumanFn = new lambdaNodejs.NodejsFunction(this, 'EscalateToHumanFn', {
      functionName: `escalate-to-human-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'escalate-to-human/index.ts'),
      handler: 'handler',
      environment: {
        NEGOTIATION_STATE_TABLE_NAME: dataStack.negotiationStateTableName,
      },
      bundling: {
        externalModules: [],
      },
    });

    // Least-privilege: GetItem on NegotiationState only
    dataStack.negotiationStateTable.grant(this.escalateToHumanFn, 'dynamodb:GetItem');

    // -------------------------------------------------------------------------
    // 4.8 send_confirmation Lambda
    // Requirements: 5.5
    // -------------------------------------------------------------------------
    this.sendConfirmationFn = new lambdaNodejs.NodejsFunction(this, 'SendConfirmationFn', {
      functionName: `send-confirmation-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'send-confirmation/index.ts'),
      handler: 'handler',
      environment: {
        CONFIRMATION_SNS_TOPIC_ARN: `arn:aws:sns:${this.region}:${this.account}:debt-negotiator-confirmations-${props.config.envName}`,
        SES_FROM_ADDRESS: 'no-reply@example.com',
      },
      bundling: {
        externalModules: [],
      },
    });

    // Least-privilege: SNS Publish + SES SendEmail
    this.sendConfirmationFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sns:Publish'],
        resources: [
          `arn:aws:sns:${this.region}:${this.account}:debt-negotiator-confirmations-${props.config.envName}`,
        ],
      }),
    );

    this.sendConfirmationFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'], // SES SendEmail requires * or verified identity ARN
      }),
    );

    // -------------------------------------------------------------------------
    // CloudFormation outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'LookupAccountFnArn', { value: this.lookupAccountFn.functionArn });
    new cdk.CfnOutput(this, 'CalculatePaymentPlanFnArn', { value: this.calculatePaymentPlanFn.functionArn });
    new cdk.CfnOutput(this, 'ApplyDiscountFnArn', { value: this.applyDiscountFn.functionArn });
    new cdk.CfnOutput(this, 'ScheduleCallbackFnArn', { value: this.scheduleCallbackFn.functionArn });
    new cdk.CfnOutput(this, 'EscalateToHumanFnArn', { value: this.escalateToHumanFn.functionArn });
    new cdk.CfnOutput(this, 'SendConfirmationFnArn', { value: this.sendConfirmationFn.functionArn });

    // TODO (Task 5): implement Bedrock Agent, Lex V2 Bot, and Strategy_Generator Lambda
  }
}
