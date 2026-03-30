import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config';
import { DataStack } from './data-stack';

export interface ConnectStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
  dataStack: DataStack;
}

/**
 * ConnectStack — Amazon Connect instance and telephony resources.
 *
 * Provisions:
 *  - Amazon Connect instance (debt-negotiator-dev / staging / prod)
 *  - Phone numbers
 *  - Hours of operation
 *
 * Requirements: 9.7, 10.6
 */
export class ConnectStack extends cdk.Stack {
  // Exported references consumed by CampaignStack and ConversationStack
  public readonly connectInstanceArn: string = '';
  public readonly connectInstanceId: string = '';

  constructor(scope: Construct, id: string, props: ConnectStackProps) {
    super(scope, id, props);

    // TODO (Task 3): implement Connect instance, phone numbers, hours of operation
  }
}
