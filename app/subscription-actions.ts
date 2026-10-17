'use server';
import { currentUser } from '@/lib/session';
import { prepareEnrollment,completeEnrollment } from '@/lib/subscription-enrollment';
import { createSubscriptionHostedCheckout } from '@/lib/hosted-checkout';
import { throttle } from '@/lib/auth-service';
import { revalidatePath } from 'next/cache';
export async function prepareSubscription(key:string,mode:'trial'|'paid') {
  const user=await currentUser();if(!user)throw new Error('Please sign in first.');
  if(!['trial','paid'].includes(mode))throw new Error('Choose trial or subscription.');
  await throttle(`setup:${user.id}`,20);
  try{return {data:await prepareEnrollment(user.id,key,mode)};}catch(error){return {error:error instanceof Error?error.message:'Unable to prepare card setup.'};}
}
export async function finishSubscription(setupId:string,consent:boolean) {
  const user=await currentUser();if(!user)throw new Error('Please sign in first.');
  await throttle(`subscribe:${user.id}`,20);
  try{const data=await completeEnrollment(user.id,setupId,consent);revalidatePath('/dashboard');return {data};}catch(error){return {error:error instanceof Error?error.message:'Unable to finish subscription.'};}
}

/** Stripe-hosted Checkout on pay.onefinsolution.store (returns apex URL after pay). */
export async function startHostedSubscriptionCheckout(
  planKey: string,
  mode: 'trial' | 'paid',
) {
  const user = await currentUser();
  if (!user) return { error: 'Please sign in first.' } as const;
  if (!['trial', 'paid'].includes(mode)) {
    return { error: 'Choose trial or subscription.' } as const;
  }
  await throttle(`hosted-sub:${user.id}`, 12);
  try {
    const data = await createSubscriptionHostedCheckout({ planKey, mode });
    return { data } as const;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unable to start secure checkout.',
    } as const;
  }
}
