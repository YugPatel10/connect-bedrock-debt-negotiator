import * as cdk from 'aws-cdk-lib';
import * as connect from 'aws-cdk-lib/aws-connect';
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
 *  - Amazon Connect instance (debt-negotiator-{envName})
 *  - Hours of operation (Mon-Fri 8am-8pm EST)
 *  - Phone number (US toll-free)
 *
 * Requirements: 9.7, 10.6
 */
export class ConnectStack extends cdk.Stack {
  public readonly connectInstanceArn: string;
  public readonly connectInstanceId: string;
  public readonly hoursOfOperationArn: string;

  constructor(scope: Construct, id: string, props: ConnectStackProps) {
    super(scope, id, props);

    const { config } = props;
    const envName = config.envName;

    // -------------------------------------------------------------------------
    // 3.1 Amazon Connect instance — import existing instance
    // The instance was created manually (alias: debt-negotiator-dev).
    // We import it by ARN so dependent resources (hours of op, queue, flow)
    // are created inside the correct instance.
    // Requirements: 9.7
    // -------------------------------------------------------------------------
    const INSTANCE_ID = 'feb464e6-13bf-42c0-af7c-d3e9293cac17';
    const INSTANCE_ARN = `arn:aws:connect:us-east-1:855676085285:instance/${INSTANCE_ID}`;

    this.connectInstanceArn = INSTANCE_ARN;
    this.connectInstanceId = INSTANCE_ID;

    // -------------------------------------------------------------------------
    // 3.1 Hours of operation — Mon-Fri 8am-8pm EST
    // Requirements: 9.7
    // -------------------------------------------------------------------------
    const businessDays: connect.CfnHoursOfOperation.HoursOfOperationConfigProperty[] = [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
    ].map((day) => ({
      day,
      startTime: { hours: 8, minutes: 0 },
      endTime: { hours: 20, minutes: 0 },
    }));

    const hoursOfOperation = new connect.CfnHoursOfOperation(this, 'BusinessHours', {
      instanceArn: INSTANCE_ARN,
      name: `BusinessHours-${envName}`,
      description: 'Standard business hours Mon-Fri 8am-8pm EST',
      timeZone: 'America/New_York',
      config: businessDays,
    });

    this.hoursOfOperationArn = hoursOfOperation.attrHoursOfOperationArn;

    // -------------------------------------------------------------------------
    // 3.1 Phone number — US toll-free in us-east-1
    // Requirements: 9.7
    // -------------------------------------------------------------------------
    const phoneNumber = new connect.CfnPhoneNumber(this, 'TollFreeNumber', {
      targetArn: INSTANCE_ARN,
      type: 'TOLL_FREE',
      countryCode: 'US',
      description: `Debt negotiator toll-free number (${envName})`,
    });

    // -------------------------------------------------------------------------
    // 3.2 Apply resource tags to all Connect resources
    // Requirements: 10.6
    // -------------------------------------------------------------------------
    cdk.Tags.of(hoursOfOperation).add('environment', envName);
    cdk.Tags.of(hoursOfOperation).add('project', 'autonomous-debt-negotiator');
    cdk.Tags.of(hoursOfOperation).add('cost-center', 'collections-ai');

    cdk.Tags.of(phoneNumber).add('environment', envName);
    cdk.Tags.of(phoneNumber).add('project', 'autonomous-debt-negotiator');
    cdk.Tags.of(phoneNumber).add('cost-center', 'collections-ai');

    // -------------------------------------------------------------------------
    // CloudFormation outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ConnectInstanceArn', {
      value: this.connectInstanceArn,
      description: 'Amazon Connect instance ARN',
      exportName: `ConnectInstanceArn-${envName}`,
    });

    new cdk.CfnOutput(this, 'ConnectInstanceId', {
      value: this.connectInstanceId,
      description: 'Amazon Connect instance ID',
      exportName: `ConnectInstanceId-${envName}`,
    });

    new cdk.CfnOutput(this, 'PhoneNumberArn', {
      value: phoneNumber.attrPhoneNumberArn,
      description: 'Claimed phone number ARN',
      exportName: `PhoneNumberArn-${envName}`,
    });
  }
}
