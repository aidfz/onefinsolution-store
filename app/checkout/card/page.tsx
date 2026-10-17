import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';

/**
 * Legacy "save workspace card" route.
 * Cards are no longer saved via a separate SetupIntent / $0 verification step.
 * A real credit purchase (hosted Checkout or PaymentIntent with setup_future_usage)
 * saves the payment method after a successful charge.
 */
export default async function CheckoutCardPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/checkout/credits');
  redirect('/checkout/credits');
}
