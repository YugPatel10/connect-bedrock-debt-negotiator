/**
 * Shared TypeScript interfaces for the Autonomous Debt Resolution Agent.
 * All interfaces are derived from the design document.
 */

// ---------------------------------------------------------------------------
// Campaign_Manager interfaces
// ---------------------------------------------------------------------------

export interface CampaignBatchRequest {
  campaignId: string;
  customerSegmentFilter?: Record<string, string>;
  dialerConfig: {
    type: 'PREDICTIVE';
    bandwidthAllocation: number; // 0.0 – 1.0
    abandonmentRateThreshold: number; // e.g. 0.03 for 3%
  };
  retryPolicy: {
    maxRetries: number;
    retryWindowMinutes: number;
    retryableDispositions: ('no_answer' | 'busy' | 'voicemail')[];
  };
}

export interface DialAttemptResult {
  contactId: string;
  customerId: string;
  disposition: 'answered' | 'no_answer' | 'busy' | 'voicemail' | 'error';
  timestamp: string; // ISO 8601
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Strategy_Generator interfaces
// ---------------------------------------------------------------------------

export interface StrategyGeneratorEvent {
  contactId: string;
  customerId: string;
}

export interface PaymentPlanOption {
  planId: string;
  monthlyAmount: number;
  numberOfMonths: number;
  totalAmount: number;
  interestRate: number;
}

export interface StrategyTemplate {
  recommendedTone: 'empathetic' | 'professional' | 'assertive';
  openingOfferRange: { minPercent: number; maxPercent: number };
  discountAuthorityLimit: number; // max discount percentage
  escalationThresholds: {
    maxTurns: number;
    sentimentTrigger: 'sustained_negative';
    sentimentDurationSeconds: number;
  };
  suggestedPaymentPlans: PaymentPlanOption[];
}

export interface StrategyGeneratorResponse {
  strategyId: string;
  contactId: string;
  template: StrategyTemplate;
  generatedAt: string; // ISO 8601
  source: 'bedrock' | 'default_fallback';
}

// ---------------------------------------------------------------------------
// Tool_Action input/output interfaces
// ---------------------------------------------------------------------------

export interface LookupAccountInput {
  customerId: string;
}

export interface LookupAccountOutput {
  balance: number;
  minimumPayment: number;
  status: string;
  daysPastDue: number;
}

export interface CalculatePaymentPlanInput {
  balance: number;
  proposedTerms: {
    monthlyAmount?: number;
    numberOfMonths?: number;
  };
}

export interface CalculatePaymentPlanOutput {
  plans: PaymentPlanOption[];
}

export interface ApplyDiscountInput {
  customerId: string;
  discountPercent: number;
  contactId: string;
}

export interface ApplyDiscountOutput {
  approved: boolean;
  reason?: string;
  newBalance: number;
}

export interface ScheduleCallbackInput {
  customerId: string;
  preferredTime: string; // ISO 8601
  contactId: string;
}

export interface ScheduleCallbackOutput {
  callbackId: string;
  scheduledTime: string; // ISO 8601
}

export interface EscalateToHumanInput {
  contactId: string;
  reason: string;
  negotiationContext: string;
}

export interface EscalateToHumanOutput {
  queueId: string;
  estimatedWaitMinutes: number;
}

export interface SendConfirmationInput {
  customerId: string;
  contactId: string;
  channel: 'sms' | 'email';
  agreementSummary: string;
}

export interface SendConfirmationOutput {
  confirmationId: string;
  deliveryStatus: 'sent' | 'failed';
}

// Union type for all tool actions
export type ToolAction =
  | 'lookup_account'
  | 'calculate_payment_plan'
  | 'apply_discount'
  | 'schedule_callback'
  | 'escalate_to_human'
  | 'send_confirmation';

// ---------------------------------------------------------------------------
// Lex V2 Bot interfaces
// ---------------------------------------------------------------------------

export type GreetingIntent =
  | 'willing_to_discuss'
  | 'request_callback'
  | 'dispute'
  | 'hang_up';

export interface LexSessionOutput {
  detectedIntent: GreetingIntent;
  confidence: number;
  customerUtterance: string;
}

// ---------------------------------------------------------------------------
// Sentiment_Monitor interfaces
// ---------------------------------------------------------------------------

export interface SentimentEvent {
  contactId: string;
  timestamp: string; // ISO 8601
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  sentimentScore: {
    positive: number;
    neutral: number;
    negative: number;
  };
  consecutiveNegativeSeconds: number;
}

// ---------------------------------------------------------------------------
// Post-call EventBridge event
// ---------------------------------------------------------------------------

export interface PostCallEvent {
  source: 'autonomous-debt-negotiator';
  detailType: 'CallCompleted';
  detail: {
    contactId: string;
    customerId: string;
    campaignBatchId: string;
    outcome: string;
    callDurationSeconds: number;
    turnCount: number;
    discountApplied: boolean;
    discountPercent?: number;
    escalated: boolean;
    sentimentSummary: {
      averageSentiment: string;
      negativeSeconds: number;
    };
    completedAt: string; // ISO 8601
  };
}

// ---------------------------------------------------------------------------
// Optimization_Engine interfaces
// ---------------------------------------------------------------------------

export interface OptimizationInput {
  campaignBatchId: string;
  completedAt: string; // ISO 8601
}

export interface BatchMetrics {
  campaignBatchId: string;
  totalCalls: number;
  resolutionRate: number;
  averageCallDurationSeconds: number;
  escalationRate: number;
  discountUtilization: number;
  outcomeBreakdown: Record<string, number>;
}
