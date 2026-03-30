import * as cdk from 'aws-cdk-lib';
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
}

/**
 * ConversationStack — call flow and real-time processing.
 *
 * Provisions:
 *  - Contact Flow (5-phase orchestration)
 *  - Contact Lens real-time analytics configuration
 *  - Sentiment event writer Lambda
 *  - Post-call Lambda
 *  - EventBridge rule for CallCompleted events
 *
 * Requirements: 9.5, 4.3–4.5, 6.1–6.5, 7.1–7.4
 */
export class ConversationStack extends cdk.Stack {
  public readonly contactFlowId: string = '';
  public readonly eventBridgeRuleArn: string = '';

  constructor(scope: Construct, id: string, props: ConversationStackProps) {
    super(scope, id, props);

    // TODO (Task 8): implement Contact Flow, Contact Lens config, sentiment writer,
    //               post-call Lambda, and EventBridge rule
  }
}
