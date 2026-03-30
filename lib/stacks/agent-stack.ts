import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config';
import { DataStack } from './data-stack';

export interface AgentStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
  dataStack: DataStack;
}

/**
 * AgentStack — AI agent and bot definitions.
 *
 * Provisions:
 *  - Bedrock Agent with Action Group (6 Tool_Action Lambdas)
 *  - Lex V2 Bot (greeting + intent detection)
 *  - Strategy_Generator Lambda
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

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    // TODO (Task 4 & 5): implement Bedrock Agent, Lex V2 Bot, and all Tool_Action Lambdas
  }
}
