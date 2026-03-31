# Autonomous Debt Resolution Agent

An AI-powered outbound collections system that integrates Amazon Connect Outbound Campaigns with Amazon Bedrock to conduct fully autonomous, multi-turn debt negotiation conversations. The system dials customers using a predictive dialer, generates a personalized negotiation strategy before each call via Bedrock, conducts real-time sentiment-aware conversations through a Bedrock Agent with six tool actions, and continuously optimizes campaign strategies using a Step Functions post-call learning loop — all defined as CDK TypeScript IaC across six stacks.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         bin/app.ts (CDK App)                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ instantiates
        ┌──────────────────────┼──────────────────────────────┐
        │                      │                              │
        ▼                      ▼                              ▼
┌──────────────┐    ┌──────────────────┐          ┌──────────────────┐
│  DataStack   │    │  ConnectStack    │          │   AgentStack     │
│              │    │                  │          │                  │
│ DynamoDB:    │    │ Connect Instance │          │ Bedrock Agent    │
│  CustomerRec │    │ Hours of Op      │          │ Lex V2 Bot       │
│  NegotState  │    │ Phone Number     │          │ Strategy Gen λ   │
│              │    │                  │          │ 6 Tool Action λs │
│ S3 Buckets:  │    └──────────────────┘          └──────────────────┘
│  recordings  │              │                              │
│  transcripts │              │                              │
│  strategy-   │    ┌─────────┴──────────┐                  │
│  logs        │    │   CampaignStack    │                  │
│              │    │                    │                  │
│ KMS Key      │    │ Outbound Campaign  │                  │
└──────┬───────┘    │ Campaign Mgr λ     │                  │
       │            └────────────────────┘                  │
       │                                                     │
       │            ┌────────────────────────────────────────┘
       │            │
       ▼            ▼
┌──────────────────────────────┐     ┌──────────────────────────────┐
│     ConversationStack        │     │     OptimizationStack        │
│                              │     │                              │
│ Contact Flow (5-phase)       │     │ Step Functions state machine │
│ Sentiment Writer λ           │     │  AggregateOutcomes λ         │
│ Post-Call λ                  │────▶│  SummarizePatterns λ         │
│ EventBridge Rule             │     │  UpdateStrategyTemplates λ   │
│                              │     │  StoreMetrics λ              │
└──────────────────────────────┘     └──────────────────────────────┘
```

## Stack Descriptions

| Stack | Purpose |
|---|---|
| `DataStack` | DynamoDB tables (CustomerRecord, NegotiationState), KMS key, S3 buckets (recordings, transcripts, strategy-logs) |
| `ConnectStack` | Amazon Connect instance, hours of operation, toll-free phone number |
| `AgentStack` | Bedrock Agent + Action Group, Lex V2 greeting bot, Strategy Generator Lambda, 6 Tool Action Lambdas |
| `CampaignStack` | Connect Outbound Campaign (predictive dialer), Campaign Manager Lambda |
| `ConversationStack` | 5-phase Contact Flow, Sentiment Writer Lambda, Post-Call Lambda, EventBridge rule |
| `OptimizationStack` | Step Functions post-call learning loop with 4 Lambda stages and retry/failure handling |

## Deployment

### Prerequisites

- Node.js 20+
- AWS CDK v2 (`npm install -g aws-cdk`)
- AWS credentials configured for account `855676085285` / `us-east-1`

### Steps

```bash
# Install dependencies
npm install

# Bootstrap CDK (first time only per account/region)
cdk bootstrap aws://855676085285/us-east-1

# Deploy all stacks to dev
cdk deploy --all -c env=dev

# Deploy to a specific environment
cdk deploy --all -c env=staging
cdk deploy --all -c env=prod
```

## Testing

```bash
# TypeScript type checking (no emit)
npx tsc --noEmit

# IaC validation — synthesize CloudFormation templates
cdk synth -c env=dev
```
