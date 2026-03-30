import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
 *  - Customer_Record DynamoDB table (PK: customerId, GSI: campaignBatchId-index)
 *  - Negotiation_State DynamoDB table (PK: contactId, GSI: customerId-index)
 *  - KMS key for S3 encryption
 *  - S3 buckets: recordings, transcripts, strategy-logs
 *
 * Requirements: 9.2, 10.1, 10.2, 10.4, 7.5
 */
export class DataStack extends cdk.Stack {
  // CDK resource objects (for grantReadWrite etc.)
  public readonly customerRecordTable: dynamodb.Table;
  public readonly negotiationStateTable: dynamodb.Table;
  public readonly dataKey: kms.Key;
  public readonly recordingsBucket: s3.Bucket;
  public readonly transcriptsBucket: s3.Bucket;
  public readonly strategyLogsBucket: s3.Bucket;

  // ARNs / names for cross-stack references
  public readonly customerRecordTableArn: string;
  public readonly customerRecordTableName: string;
  public readonly negotiationStateTableArn: string;
  public readonly negotiationStateTableName: string;
  public readonly dataKeyArn: string;
  public readonly recordingsBucketArn: string;
  public readonly recordingsBucketName: string;
  public readonly transcriptsBucketArn: string;
  public readonly transcriptsBucketName: string;
  public readonly strategyLogsBucketArn: string;
  public readonly strategyLogsBucketName: string;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // Apply resource tags
    Object.entries(props.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    // -------------------------------------------------------------------------
    // 2.1 Customer_Record DynamoDB table
    // Requirements: 9.2, 10.1
    // -------------------------------------------------------------------------
    this.customerRecordTable = new dynamodb.Table(this, 'CustomerRecordTable', {
      tableName: `CustomerRecord-${props.config.envName}`,
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      billingMode: props.config.dynamoDbBillingMode,
      readCapacity:
        props.config.dynamoDbBillingMode === dynamodb.BillingMode.PROVISIONED
          ? props.config.dynamoDbReadCapacity
          : undefined,
      writeCapacity:
        props.config.dynamoDbBillingMode === dynamodb.BillingMode.PROVISIONED
          ? props.config.dynamoDbWriteCapacity
          : undefined,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: campaignBatchId-index
    this.customerRecordTable.addGlobalSecondaryIndex({
      indexName: 'campaignBatchId-index',
      partitionKey: { name: 'campaignBatchId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.customerRecordTableArn = this.customerRecordTable.tableArn;
    this.customerRecordTableName = this.customerRecordTable.tableName;

    // -------------------------------------------------------------------------
    // 2.2 Negotiation_State DynamoDB table
    // Requirements: 7.5, 9.2, 10.1
    // -------------------------------------------------------------------------
    this.negotiationStateTable = new dynamodb.Table(this, 'NegotiationStateTable', {
      tableName: `NegotiationState-${props.config.envName}`,
      partitionKey: { name: 'contactId', type: dynamodb.AttributeType.STRING },
      billingMode: props.config.dynamoDbBillingMode,
      readCapacity:
        props.config.dynamoDbBillingMode === dynamodb.BillingMode.PROVISIONED
          ? props.config.dynamoDbReadCapacity
          : undefined,
      writeCapacity:
        props.config.dynamoDbBillingMode === dynamodb.BillingMode.PROVISIONED
          ? props.config.dynamoDbWriteCapacity
          : undefined,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      // TTL attribute enabled; Lambda code sets value to 7+ years from creation
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: customerId-index (PK: customerId, SK: startedAt)
    this.negotiationStateTable.addGlobalSecondaryIndex({
      indexName: 'customerId-index',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.negotiationStateTableArn = this.negotiationStateTable.tableArn;
    this.negotiationStateTableName = this.negotiationStateTable.tableName;

    // -------------------------------------------------------------------------
    // 2.3 KMS key + S3 buckets
    // Requirements: 9.2, 10.2, 10.4
    // -------------------------------------------------------------------------
    this.dataKey = new kms.Key(this, 'DataKey', {
      description: `Autonomous Debt Negotiator data encryption key (${props.config.envName})`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.dataKeyArn = this.dataKey.keyArn;

    const bucketDefaults: Partial<s3.BucketProps> = {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.dataKey,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    };

    this.recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
      ...bucketDefaults,
      bucketName: `debt-negotiator-recordings-${props.config.envName}-${this.account}`,
    });

    this.transcriptsBucket = new s3.Bucket(this, 'TranscriptsBucket', {
      ...bucketDefaults,
      bucketName: `debt-negotiator-transcripts-${props.config.envName}-${this.account}`,
    });

    this.strategyLogsBucket = new s3.Bucket(this, 'StrategyLogsBucket', {
      ...bucketDefaults,
      bucketName: `debt-negotiator-strategy-logs-${props.config.envName}-${this.account}`,
    });

    this.recordingsBucketArn = this.recordingsBucket.bucketArn;
    this.recordingsBucketName = this.recordingsBucket.bucketName;
    this.transcriptsBucketArn = this.transcriptsBucket.bucketArn;
    this.transcriptsBucketName = this.transcriptsBucket.bucketName;
    this.strategyLogsBucketArn = this.strategyLogsBucket.bucketArn;
    this.strategyLogsBucketName = this.strategyLogsBucket.bucketName;

    // -------------------------------------------------------------------------
    // CloudFormation outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'CustomerRecordTableArn', { value: this.customerRecordTableArn });
    new cdk.CfnOutput(this, 'NegotiationStateTableArn', { value: this.negotiationStateTableArn });
    new cdk.CfnOutput(this, 'DataKeyArn', { value: this.dataKeyArn });
    new cdk.CfnOutput(this, 'RecordingsBucketArn', { value: this.recordingsBucketArn });
    new cdk.CfnOutput(this, 'TranscriptsBucketArn', { value: this.transcriptsBucketArn });
    new cdk.CfnOutput(this, 'StrategyLogsBucketArn', { value: this.strategyLogsBucketArn });
  }
}
