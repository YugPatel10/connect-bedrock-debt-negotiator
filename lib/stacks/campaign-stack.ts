import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config';
import { ConnectStack } from './connect-stack';

export interface CampaignStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
  connectStack: ConnectStack;
}

/**
 * CampaignStack — outbound campaign orchestration.
 *
 * Provisions:
 *  - Amazon Connect Outbound Campaign (predictive dialer)
 *  - Campaign_Manager Lambda
 *
 * Requirements: 1.1, 1.5, 9.4
 */
export class CampaignStack extends cdk.Stack {
  public readonly outboundCampaignId: string = '';

  constructor(scope: Construct, id: string, props: CampaignStackProps) {
    super(scope, id, props);

    // TODO (Task 7): implement outbound campaign and Campaign_Manager Lambda
  }
}
