import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SendConfirmationInput, SendConfirmationOutput } from '../../../lib/types.js';
import { randomUUID } from 'crypto';

const sns = new SNSClient({});
const ses = new SESClient({});

const SNS_TOPIC_ARN = process.env.CONFIRMATION_SNS_TOPIC_ARN!;
const SES_FROM_ADDRESS = process.env.SES_FROM_ADDRESS ?? 'no-reply@example.com';

export const handler = async (event: SendConfirmationInput): Promise<SendConfirmationOutput> => {
  const { customerId, contactId, channel, agreementSummary } = event;
  const confirmationId = randomUUID();

  try {
    if (channel === 'sms') {
      await sns.send(
        new PublishCommand({
          TopicArn: SNS_TOPIC_ARN,
          Message: agreementSummary,
          MessageAttributes: {
            customerId: { DataType: 'String', StringValue: customerId },
            contactId: { DataType: 'String', StringValue: contactId },
            confirmationId: { DataType: 'String', StringValue: confirmationId },
          },
        }),
      );
    } else {
      // email via SES
      await ses.send(
        new SendEmailCommand({
          Source: SES_FROM_ADDRESS,
          Destination: {
            // In production, the customer email would be looked up from Customer_Record
            ToAddresses: [`${customerId}@placeholder.example.com`],
          },
          Message: {
            Subject: { Data: 'Your Payment Agreement Confirmation' },
            Body: { Text: { Data: agreementSummary } },
          },
        }),
      );
    }

    return { confirmationId, deliveryStatus: 'sent' };
  } catch (err) {
    console.error('Failed to send confirmation', err);
    return { confirmationId, deliveryStatus: 'failed' };
  }
};
