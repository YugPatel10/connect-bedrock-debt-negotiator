import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config';

export interface DataStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
}

/**
 * DataStack — foundational persistence layer.
 *
 * Provisions:
 *  - Customer_Record DynamoDB table
 *  - Negotiation_State DynamoDB table
 *  - KMS key
 *  - S3 buckets: recordings, transcripts, strategy-logs
 *
 * Requirements: 9.2, 10.1, 10.2, 10.4, 7.5
 */
export class DataStack extends cdk.Stack {
  // Exported references consumed by dependent stacks (populated in Task 2)
  public readonly customerRecordTableArn: string = '';
  public readonly negotiationStateTableArn: string = '';
  public readonly recordingsBucketArn: string = '';
  public readonly transcriptsBucketArn: string = '';
  public readonly strategyLogsBucketArn: string = '';

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // TODO (Task 2): implement DynamoDB tables, KMS key, and S3 buckets
  }
}
