import * as cdk from 'aws-cdk-lib';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as connectcampaigns from 'aws-cdk-lib/aws-connectcampaigns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';
import { ConnectStack } from './connect-stack.js';
import { DataStack } from './data-stack.js';

export interface CampaignStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
  connectStack: ConnectStack;
  dataStack: DataStack;
}

/**
 * CampaignStack — outbound campaign orchestration.
 *
 * Provisions:
 *  - Connect Queue for routing answered calls
 *  - Amazon Connect Outbound Campaign (predictive dialer)
 *  - Campaign_Manager Lambda
 *
 * Requirements: 1.1, 1.5, 9.4
 */
export class CampaignStack extends cdk.Stack {
  public readonly outboundCampaignId: string;

  constructor(scope: Construct, id: string, props: CampaignStackProps) {
    super(scope, id, props);

    const { config, connectStack, dataStack } = props;
    const envName = config.envName;

    // Apply resource tags
    Object.entries(props.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    // -------------------------------------------------------------------------
    // 7.1 Connect Queue — routes answered calls from the campaign
    // Requirements: 1.1, 9.4
    // -------------------------------------------------------------------------
    const campaignQueue = new connect.CfnQueue(this, 'CampaignQueue', {
      instanceArn: connectStack.connectInstanceArn,
      name: `debt-negotiator-queue-${envName}`,
      description: `Outbound campaign queue for debt negotiator (${envName})`,
      hoursOfOperationArn: connectStack.hoursOfOperationArn,
    });

    // -------------------------------------------------------------------------
    // 7.1 Outbound Campaign (predictive dialer)
    // Requirements: 1.1, 1.5, 9.4
    // -------------------------------------------------------------------------
    // Note: abandonmentRateThreshold is enforced at the Lambda/API level via
    // PutDialRequestBatch — the CfnCampaign L1 construct's PredictiveDialerConfig
    // only exposes bandwidthAllocation and dialingCapacity.
    const cfnCampaign = new connectcampaigns.CfnCampaign(this, 'OutboundCampaign', {
      name: `debt-negotiator-campaign-${envName}`,
      connectInstanceArn: connectStack.connectInstanceArn,
      dialerConfig: {
        predictiveDialerConfig: {
          bandwidthAllocation: config.dialer.bandwidthAllocation,
        },
      },
      outboundCallConfig: {
        connectContactFlowArn: `arn:aws:connect:us-east-1:855676085285:instance/feb464e6-13bf-42c0-af7c-d3e9293cac17/contact-flow/e7bf2eee-80c5-4a6f-b933-e9a8cdfdf724`,
        connectQueueArn: campaignQueue.attrQueueArn,
        connectSourcePhoneNumber: '+18559535825',
      },
    });

    this.outboundCampaignId = cfnCampaign.attrArn;

    // -------------------------------------------------------------------------
    // 7.2 Campaign_Manager Lambda
    // Requirements: 1.1, 1.2, 1.3, 1.4
    // -------------------------------------------------------------------------
    const campaignManagerFn = new lambdaNodejs.NodejsFunction(this, 'CampaignManagerFn', {
      functionName: `campaign-manager-${envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../lambdas/campaign-manager/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(300),
      environment: {
        CUSTOMER_RECORD_TABLE_NAME: dataStack.customerRecordTableName,
        OUTBOUND_CAMPAIGN_ID: cfnCampaign.attrArn,
        ABANDONMENT_RATE_THRESHOLD: String(config.dialer.abandonmentRateThreshold),
        MAX_RETRIES: String(config.retry.maxRetries),
        RETRY_WINDOW_MINUTES: String(config.retry.retryWindowMinutes),
      },
      bundling: { externalModules: [] },
    });

    // DynamoDB: Query on CustomerRecord (campaignBatchId-index GSI)
    dataStack.customerRecordTable.grant(campaignManagerFn, 'dynamodb:Query');
    // DynamoDB: UpdateItem on CustomerRecord (retry tracking)
    dataStack.customerRecordTable.grant(campaignManagerFn, 'dynamodb:UpdateItem');

    // connect-campaigns-v2:PutOutboundRequestBatch (Requirements: 1.1, 9.4)
    campaignManagerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['connect-campaigns-v2:PutOutboundRequestBatch'],
      resources: [cfnCampaign.attrArn],
    }));

    // -------------------------------------------------------------------------
    // CloudFormation outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'OutboundCampaignArn', {
      value: cfnCampaign.attrArn,
      description: 'Outbound campaign ARN',
      exportName: `OutboundCampaignArn-${envName}`,
    });

    new cdk.CfnOutput(this, 'CampaignManagerFnArn', {
      value: campaignManagerFn.functionArn,
      description: 'Campaign Manager Lambda ARN',
      exportName: `CampaignManagerFnArn-${envName}`,
    });

    new cdk.CfnOutput(this, 'CampaignQueueArn', {
      value: campaignQueue.attrQueueArn,
      description: 'Campaign queue ARN',
      exportName: `CampaignQueueArn-${envName}`,
    });
  }
}
