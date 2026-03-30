import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config';
import { DataStack } from './data-stack';

export interface OptimizationStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  tags: Record<string, string>;
  dataStack: DataStack;
}

/**
 * OptimizationStack — post-call learning loop.
 *
 * Provisions:
 *  - Step Functions state machine (4 stages with retry logic)
 *  - aggregate-outcomes Lambda
 *  - summarize-patterns Lambda
 *  - update-strategy-templates Lambda
 *  - store-metrics Lambda
 *  - Bedrock invocation IAM permissions
 *
 * Requirements: 8.5, 8.6, 9.6
 */
export class OptimizationStack extends cdk.Stack {
  public readonly stateMachineArn: string = '';

  constructor(scope: Construct, id: string, props: OptimizationStackProps) {
    super(scope, id, props);

    // TODO (Task 9): implement Step Functions state machine and optimization Lambdas
  }
}
