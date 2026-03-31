import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lex from 'aws-cdk-lib/aws-lex';
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
  public readonly bedrockAgentId: string;
  public readonly bedrockAgentAliasId: string;
  public readonly lexBotId: string;
  public readonly lexBotAliasId: string;
  public readonly strategyGeneratorFunctionArn: string;

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
    // 4.2 lookup_account Lambda — Requirements: 5.2, 10.3
    // -------------------------------------------------------------------------
    this.lookupAccountFn = new lambdaNodejs.NodejsFunction(this, 'LookupAccountFn', {
      functionName: `lookup-account-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'lookup-account/index.ts'),
      handler: 'handler',
      environment: {
        CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
      },
      bundling: { externalModules: [] },
    });
    dataStack.customerRecordTable.grant(this.lookupAccountFn, 'dynamodb:GetItem');

    // -------------------------------------------------------------------------
    // 4.3 calculate_payment_plan Lambda — Requirements: 5.3
    // -------------------------------------------------------------------------
    this.calculatePaymentPlanFn = new lambdaNodejs.NodejsFunction(this, 'CalculatePaymentPlanFn', {
      functionName: `calculate-payment-plan-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'calculate-payment-plan/index.ts'),
      handler: 'handler',
      bundling: { externalModules: [] },
    });

    // -------------------------------------------------------------------------
    // 4.4 apply_discount Lambda — Requirements: 5.4, 10.3
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
      bundling: { externalModules: [] },
    });
    dataStack.negotiationStateTable.grant(this.applyDiscountFn, 'dynamodb:GetItem');
    dataStack.customerRecordTable.grant(this.applyDiscountFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    // -------------------------------------------------------------------------
    // 4.6 schedule_callback Lambda — Requirements: 4.4, 5.1
    // -------------------------------------------------------------------------
    this.scheduleCallbackFn = new lambdaNodejs.NodejsFunction(this, 'ScheduleCallbackFn', {
      functionName: `schedule-callback-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'schedule-callback/index.ts'),
      handler: 'handler',
      environment: {
        CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
      },
      bundling: { externalModules: [] },
    });
    dataStack.customerRecordTable.grant(this.scheduleCallbackFn, 'dynamodb:UpdateItem');

    // -------------------------------------------------------------------------
    // 4.7 escalate_to_human Lambda — Requirements: 4.5, 5.6
    // -------------------------------------------------------------------------
    this.escalateToHumanFn = new lambdaNodejs.NodejsFunction(this, 'EscalateToHumanFn', {
      functionName: `escalate-to-human-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, 'escalate-to-human/index.ts'),
      handler: 'handler',
      environment: {
        NEGOTIATION_STATE_TABLE_NAME: dataStack.negotiationStateTableName,
      },
      bundling: { externalModules: [] },
    });
    dataStack.negotiationStateTable.grant(this.escalateToHumanFn, 'dynamodb:GetItem');

    // -------------------------------------------------------------------------
    // 4.8 send_confirmation Lambda — Requirements: 5.5
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
      bundling: { externalModules: [] },
    });
    this.sendConfirmationFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sns:Publish'],
      resources: [`arn:aws:sns:${this.region}:${this.account}:debt-negotiator-confirmations-${props.config.envName}`],
    }));
    // SES requires '*' as the resource — SES does not support resource-level
    // permissions scoped to individual verified identity ARNs in all regions,
    // and the sending identity (email address or domain) is configured at
    // runtime via SES_FROM_ADDRESS. Least-privilege is enforced by limiting
    // actions to SendEmail/SendRawEmail only (no ses:CreateIdentity etc.).
    this.sendConfirmationFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // -------------------------------------------------------------------------
    // 5.3 Strategy_Generator Lambda — Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
    // -------------------------------------------------------------------------
    const strategyGeneratorFn = new lambdaNodejs.NodejsFunction(this, 'StrategyGeneratorFn', {
      functionName: `strategy-generator-${props.config.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../lambdas/strategy-generator/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
        NEGOTIATION_STATE_TABLE_NAME: dataStack.negotiationStateTableName,
        BEDROCK_MODEL_ID: props.config.bedrock.strategyModelId,
      },
      bundling: { externalModules: [] },
    });
    dataStack.customerRecordTable.grant(strategyGeneratorFn, 'dynamodb:GetItem');
    dataStack.negotiationStateTable.grant(strategyGeneratorFn, 'dynamodb:PutItem');
    strategyGeneratorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/${props.config.bedrock.strategyModelId}`],
    }));
    this.strategyGeneratorFunctionArn = strategyGeneratorFn.functionArn;

    // -------------------------------------------------------------------------
    // 5.1 Bedrock Agent IAM Role — Requirements: 3.1, 3.4, 5.1
    // -------------------------------------------------------------------------
    const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
      roleName: `debt-negotiator-bedrock-agent-${props.config.envName}`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'IAM role for Bedrock Debt Negotiator Agent',
    });
    bedrockAgentRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/${props.config.bedrock.strategyModelId}`],
    }));

    // -------------------------------------------------------------------------
    // 5.1 Bedrock Agent (CfnAgent L1) — Requirements: 3.1, 3.4, 5.1
    // -------------------------------------------------------------------------
    const agentInstruction =
      'You are an autonomous debt collection negotiation agent. Your goal is to help customers resolve outstanding balances through respectful, empathetic conversation. You have access to tools to look up account information, calculate payment plans, apply discounts within your authority, schedule callbacks, escalate to human agents, and send confirmations. Always follow the strategy template provided at the start of each conversation. Never exceed the discount authority limit. Escalate to a human agent if the customer is distressed, disputes the debt, or if you reach the maximum number of negotiation turns without resolution.';

    const cfnAgent = new bedrock.CfnAgent(this, 'DebtNegotiatorAgent', {
      agentName: `debt-negotiator-agent-${props.config.envName}`,
      foundationModel: props.config.bedrock.strategyModelId,
      agentResourceRoleArn: bedrockAgentRole.roleArn,
      instruction: agentInstruction,
      autoPrepare: true,
      idleSessionTtlInSeconds: 600,
      actionGroups: [
        {
          actionGroupName: 'DebtNegotiationTools',
          actionGroupState: 'ENABLED',
          actionGroupExecutor: { lambda: this.lookupAccountFn.functionArn },
          functionSchema: {
            functions: [
              {
                name: 'lookup_account',
                description: 'Look up customer account information including balance, minimum payment, status, and days past due.',
                parameters: {
                  customerId: { type: 'string', description: 'The unique identifier of the customer.', required: true },
                },
              },
              {
                name: 'calculate_payment_plan',
                description: 'Calculate available payment plan options given a balance and proposed terms.',
                parameters: {
                  balance: { type: 'number', description: 'The outstanding balance amount.', required: true },
                  monthlyAmount: { type: 'number', description: 'Proposed monthly payment amount (optional).', required: false },
                  numberOfMonths: { type: 'number', description: 'Proposed number of months for the plan (optional).', required: false },
                },
              },
              {
                name: 'apply_discount',
                description: 'Apply a discount to the customer account if within the authority limit defined in the strategy template.',
                parameters: {
                  customerId: { type: 'string', description: 'The unique identifier of the customer.', required: true },
                  discountPercent: { type: 'number', description: 'The discount percentage to apply.', required: true },
                  contactId: { type: 'string', description: 'The active contact ID for this call.', required: true },
                },
              },
              {
                name: 'schedule_callback',
                description: 'Schedule a callback for the customer at their preferred time.',
                parameters: {
                  customerId: { type: 'string', description: 'The unique identifier of the customer.', required: true },
                  preferredTime: { type: 'string', description: 'The preferred callback time in ISO 8601 format.', required: true },
                  contactId: { type: 'string', description: 'The active contact ID for this call.', required: true },
                },
              },
              {
                name: 'escalate_to_human',
                description: 'Escalate the call to a human agent with full negotiation context.',
                parameters: {
                  contactId: { type: 'string', description: 'The active contact ID for this call.', required: true },
                  reason: { type: 'string', description: 'The reason for escalation.', required: true },
                  negotiationContext: { type: 'string', description: 'Summary of the negotiation context to pass to the human agent.', required: true },
                },
              },
              {
                name: 'send_confirmation',
                description: 'Send a confirmation message to the customer via SMS or email after a resolution is reached.',
                parameters: {
                  customerId: { type: 'string', description: 'The unique identifier of the customer.', required: true },
                  contactId: { type: 'string', description: 'The active contact ID for this call.', required: true },
                  channel: { type: 'string', description: 'The delivery channel: sms or email.', required: true },
                  agreementSummary: { type: 'string', description: 'A summary of the agreed terms to include in the confirmation.', required: true },
                },
              },
            ],
          },
        },
      ],
    });

    // Grant Bedrock Agent permission to invoke all 6 Tool_Action Lambdas
    const bedrockPrincipal = new iam.ServicePrincipal('bedrock.amazonaws.com');
    this.lookupAccountFn.addPermission('BedrockAgentInvokeLookup', {
      principal: bedrockPrincipal, action: 'lambda:InvokeFunction', sourceArn: cfnAgent.attrAgentArn,
    });
    this.calculatePaymentPlanFn.addPermission('BedrockAgentInvokeCalcPlan', {
      principal: bedrockPrincipal, action: 'lambda:InvokeFunction', sourceArn: cfnAgent.attrAgentArn,
    });
    this.applyDiscountFn.addPermission('BedrockAgentInvokeDiscount', {
      principal: bedrockPrincipal, action: 'lambda:InvokeFunction', sourceArn: cfnAgent.attrAgentArn,
    });
    this.scheduleCallbackFn.addPermission('BedrockAgentInvokeCallback', {
      principal: bedrockPrincipal, action: 'lambda:InvokeFunction', sourceArn: cfnAgent.attrAgentArn,
    });
    this.escalateToHumanFn.addPermission('BedrockAgentInvokeEscalate', {
      principal: bedrockPrincipal, action: 'lambda:InvokeFunction', sourceArn: cfnAgent.attrAgentArn,
    });
    this.sendConfirmationFn.addPermission('BedrockAgentInvokeConfirm', {
      principal: bedrockPrincipal, action: 'lambda:InvokeFunction', sourceArn: cfnAgent.attrAgentArn,
    });

    // CfnAgentAlias
    const cfnAgentAlias = new bedrock.CfnAgentAlias(this, 'DebtNegotiatorAgentAlias', {
      agentId: cfnAgent.attrAgentId,
      agentAliasName: `live-${props.config.envName}`,
    });
    cfnAgentAlias.addDependency(cfnAgent);

    this.bedrockAgentId = cfnAgent.attrAgentId;
    this.bedrockAgentAliasId = cfnAgentAlias.attrAgentAliasId;

    // -------------------------------------------------------------------------
    // 5.2 Lex V2 Bot IAM Role — Requirements: 4.1, 4.2
    // -------------------------------------------------------------------------
    const lexBotRole = new iam.Role(this, 'LexBotRole', {
      roleName: `debt-negotiator-lex-bot-${props.config.envName}`,
      assumedBy: new iam.ServicePrincipal('lexv2.amazonaws.com'),
      description: 'IAM role for Lex V2 Debt Negotiator Greeting Bot',
    });
    lexBotRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    // -------------------------------------------------------------------------
    // 5.2 Lex V2 Bot (CfnBot L1) — Requirements: 4.1, 4.2
    // -------------------------------------------------------------------------
    const cfnBot = new lex.CfnBot(this, 'DebtNegotiatorGreetingBot', {
      name: `DebtNegotiatorGreeting-${props.config.envName}`,
      roleArn: lexBotRole.roleArn,
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      autoBuildBotLocales: true,
      botLocales: [
        {
          localeId: 'en_US',
          nluConfidenceThreshold: 0.4,
          voiceSettings: { voiceId: 'Joanna', engine: 'neural' },
          intents: [
            {
              name: 'WillingToDiscuss',
              description: 'Customer is willing to discuss their debt and payment options.',
              sampleUtterances: [
                { utterance: 'Yes I can talk' },
                { utterance: 'Sure go ahead' },
                { utterance: 'I am willing to discuss' },
                { utterance: 'Yes I want to resolve this' },
                { utterance: 'Okay let us talk about it' },
              ],
            },
            {
              name: 'RequestCallback',
              description: 'Customer requests a callback at a later time.',
              sampleUtterances: [
                { utterance: 'Call me back later' },
                { utterance: 'I am busy right now' },
                { utterance: 'Can you call me another time' },
                { utterance: 'Schedule a callback please' },
                { utterance: 'Not a good time' },
              ],
            },
            {
              name: 'Dispute',
              description: 'Customer disputes the debt or denies owing the amount.',
              sampleUtterances: [
                { utterance: 'I do not owe this' },
                { utterance: 'This is not my debt' },
                { utterance: 'I dispute this charge' },
                { utterance: 'I already paid this' },
                { utterance: 'This is a mistake' },
              ],
            },
            {
              name: 'HangUp',
              description: 'Customer wants to end the call.',
              sampleUtterances: [
                { utterance: 'Goodbye' },
                { utterance: 'I am hanging up' },
                { utterance: 'Do not call me again' },
                { utterance: 'Leave me alone' },
                { utterance: 'I am not interested' },
              ],
            },
            {
              name: 'FallbackIntent',
              description: 'Default fallback when no other intent matches.',
              parentIntentSignature: 'AMAZON.FallbackIntent',
            },
          ],
        },
      ],
    });

    // Create a bot version from the DRAFT
    const cfnBotVersion = new lex.CfnBotVersion(this, 'DebtNegotiatorGreetingBotVersion', {
      botId: cfnBot.attrId,
      botVersionLocaleSpecification: [
        {
          localeId: 'en_US',
          botVersionLocaleDetails: {
            sourceBotVersion: 'DRAFT',
          },
        },
      ],
    });
    cfnBotVersion.addDependency(cfnBot);

    // CfnBotAlias pointing to the versioned bot
    const cfnBotAlias = new lex.CfnBotAlias(this, 'DebtNegotiatorGreetingBotAlias', {
      botId: cfnBot.attrId,
      botAliasName: `live-${props.config.envName}`,
      botVersion: cfnBotVersion.attrBotVersion,
      botAliasLocaleSettings: [
        {
          localeId: 'en_US',
          botAliasLocaleSetting: {
            enabled: true,
          },
        },
      ],
    });
    cfnBotAlias.addDependency(cfnBot);

    this.lexBotId = cfnBot.attrId;
    this.lexBotAliasId = cfnBotAlias.attrBotAliasId;

    // -------------------------------------------------------------------------
    // CloudFormation outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'LookupAccountFnArn', { value: this.lookupAccountFn.functionArn });
    new cdk.CfnOutput(this, 'CalculatePaymentPlanFnArn', { value: this.calculatePaymentPlanFn.functionArn });
    new cdk.CfnOutput(this, 'ApplyDiscountFnArn', { value: this.applyDiscountFn.functionArn });
    new cdk.CfnOutput(this, 'ScheduleCallbackFnArn', { value: this.scheduleCallbackFn.functionArn });
    new cdk.CfnOutput(this, 'EscalateToHumanFnArn', { value: this.escalateToHumanFn.functionArn });
    new cdk.CfnOutput(this, 'SendConfirmationFnArn', { value: this.sendConfirmationFn.functionArn });
    new cdk.CfnOutput(this, 'StrategyGeneratorFnArn', { value: this.strategyGeneratorFunctionArn });
    new cdk.CfnOutput(this, 'BedrockAgentId', { value: this.bedrockAgentId });
    new cdk.CfnOutput(this, 'BedrockAgentAliasId', { value: this.bedrockAgentAliasId });
    new cdk.CfnOutput(this, 'LexBotId', { value: this.lexBotId });
    new cdk.CfnOutput(this, 'LexBotAliasId', { value: this.lexBotAliasId });
  }
}
