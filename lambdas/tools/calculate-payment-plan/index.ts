import { CalculatePaymentPlanInput, CalculatePaymentPlanOutput, PaymentPlanOption } from '../../../lib/types.js';
import { randomUUID } from 'crypto';

const INTEREST_RATE = 0.0; // 0% interest for simplicity; adjust per business rules

function buildPlan(balance: number, numberOfMonths: number): PaymentPlanOption {
  const monthlyAmount = Math.ceil((balance / numberOfMonths) * 100) / 100;
  return {
    planId: randomUUID(),
    monthlyAmount,
    numberOfMonths,
    totalAmount: Math.round(monthlyAmount * numberOfMonths * 100) / 100,
    interestRate: INTEREST_RATE,
  };
}

export const handler = async (event: CalculatePaymentPlanInput): Promise<CalculatePaymentPlanOutput> => {
  const { balance, proposedTerms } = event;

  const plans: PaymentPlanOption[] = [
    buildPlan(balance, 3),
    buildPlan(balance, 6),
    buildPlan(balance, 12),
  ];

  // If proposedTerms provided, add a custom plan
  if (proposedTerms) {
    const { monthlyAmount, numberOfMonths } = proposedTerms;

    if (numberOfMonths && numberOfMonths > 0) {
      plans.push(buildPlan(balance, numberOfMonths));
    } else if (monthlyAmount && monthlyAmount > 0) {
      const months = Math.ceil(balance / monthlyAmount);
      plans.push({
        planId: randomUUID(),
        monthlyAmount,
        numberOfMonths: months,
        totalAmount: Math.round(monthlyAmount * months * 100) / 100,
        interestRate: INTEREST_RATE,
      });
    }
  }

  return { plans };
};
