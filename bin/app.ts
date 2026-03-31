#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { getEnvironmentConfig } from '../lib/config.js';
import { DataStack } from '../lib/stacks/data-stack.js';
import { ConnectStack } from '../lib/stacks/connect-stack.js';
import { AgentStack } from '../lib/stacks/agent-stack.js';
import { CampaignStack } from '../lib/stacks/campaign-stack.js';
import { ConversationStack } from '../lib/stacks/conversation-stack.js';
import { OptimizationStack } from '../lib/stacks/optimization-stack.js';

const app = new cdk.App();

const envName = app.node.tryGetContext('env') ?? 'dev';
const config = getEnvironmentConfig(app, envName);

const env: cdk.Environment = {
  account: '855676085285',
  region: 'us-east-1',
};

const tags = {
  environment: envName,
  project: 'autonomous-debt-negotiator',
  'cost-center': 'collections-ai',
};

// DataStack is the foundation — no dependencies on other stacks
const dataStack = new DataStack(app, `DebtNegotiator-DataStack-${envName}`, {
  env,
  config,
  tags,
});

// ConnectStack depends on DataStack
const connectStack = new ConnectStack(app, `DebtNegotiator-ConnectStack-${envName}`, {
  env,
  config,
  tags,
  dataStack,
});

// AgentStack depends on DataStack
const agentStack = new AgentStack(app, `DebtNegotiator-AgentStack-${envName}`, {
  env,
  config,
  tags,
  dataStack,
});

// CampaignStack depends on ConnectStack and DataStack
const campaignStack = new CampaignStack(app, `DebtNegotiator-CampaignStack-${envName}`, {
  env,
  config,
  tags,
  connectStack,
  dataStack,
});

// OptimizationStack depends on DataStack
const optimizationStack = new OptimizationStack(app, `DebtNegotiator-OptimizationStack-${envName}`, {
  env,
  config,
  tags,
  dataStack,
});

// ConversationStack depends on ConnectStack, AgentStack, DataStack, and OptimizationStack
const conversationStack = new ConversationStack(app, `DebtNegotiator-ConversationStack-${envName}`, {
  env,
  config,
  tags,
  connectStack,
  agentStack,
  dataStack,
  optimizationStateMachineArn: optimizationStack.stateMachineArn,
});

// Suppress unused variable warnings for stacks that are wired but not yet fully implemented
void campaignStack;
void conversationStack;
void optimizationStack;

// Apply tags to all stacks
for (const stack of [dataStack, connectStack, agentStack, campaignStack, conversationStack, optimizationStack]) {
  for (const [key, value] of Object.entries(tags)) {
    cdk.Tags.of(stack).add(key, value);
  }
}

app.synth();
